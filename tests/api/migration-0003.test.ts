import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/server/db/migrate";
import * as schema from "@/server/db/schema";

const { artifactFiles, artifactVersions, artifacts, files, notebookMembers, notebooks, sources, users } = schema;

/**
 * Chạy phần "backfill" của migration 0003 trên dữ liệu cũ. Dùng DB tạm riêng để lệnh UPDATE toàn bảng
 * không đụng dữ liệu của các file test khác đang chạy song song.
 */
const baseUrl = process.env.TEST_DATABASE_URL ?? "postgres://kbm:kbm@localhost:5432/kbm_notebook_test";
const dbName = `${new URL(baseUrl).pathname.slice(1)}_mig_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
const scratchUrl = (() => {
  const u = new URL(baseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const adminUrl = (() => {
  const u = new URL(baseUrl);
  u.pathname = "/postgres";
  return u.toString();
})();

let pool: Pool;
let db: NodePgDatabase<typeof schema>;

beforeAll(async () => {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  await runMigrations(scratchUrl);
  pool = new Pool({ connectionString: scratchUrl, max: 2 });
  db = drizzle(pool, { schema });
}, 60_000);

afterAll(async () => {
  await pool?.end();
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

async function runBackfill(): Promise<void> {
  const text = fs.readFileSync(path.resolve(process.cwd(), "drizzle/0003_security_indexes.sql"), "utf8");
  const start = text.indexOf("-- ===== Dữ liệu hiện có");
  expect(start).toBeGreaterThan(0);
  for (const stmt of text.slice(start).split("--> statement-breakpoint")) {
    if (stmt.replace(/--.*$/gm, "").trim()) await db.execute(sql.raw(stmt));
  }
}

async function mkUser(name: string) {
  const [u] = await db.insert(users).values({ name, email: `${randomUUID()}@t.local` }).returning();
  return u;
}
async function mkFile(ownerId: string, name: string) {
  const [f] = await db
    .insert(files)
    .values({ ownerId, storageKey: `2026/01/${randomUUID()}`, originalName: name, mime: "image/png", sizeBytes: 3, sha256: "x" })
    .returning();
  return f;
}
async function mkNotebook(ownerId: string) {
  const [nb] = await db.insert(notebooks).values({ ownerId, title: "NB" }).returning();
  await db.insert(notebookMembers).values({ notebookId: nb.id, userId: ownerId, role: "owner" });
  return nb;
}
async function mkArtifact(notebookId: string, createdBy: string, type: "slide_deck" | "infographic" | "report", content: unknown, over: Partial<typeof artifacts.$inferInsert> = {}) {
  const [a] = await db.insert(artifacts).values({ notebookId, createdBy, type, title: "A", status: "ready", ...over }).returning();
  const [v] = await db.insert(artifactVersions).values({ artifactId: a.id, versionNo: 1, content }).returning();
  await db.update(artifacts).set({ currentVersionId: v.id }).where(eq(artifacts.id, a.id));
  return a;
}

describe("migration 0003: backfill dữ liệu cũ", () => {
  it("artifact_files chỉ nhận tệp do chủ artifact / thành viên sở hữu; files.notebook_id/origin được điền", async () => {
    const owner = await mkUser("owner");
    const editor = await mkUser("editor");
    const outsider = await mkUser("outsider");
    const nb = await mkNotebook(owner.id);
    await db.insert(notebookMembers).values({ notebookId: nb.id, userId: editor.id, role: "editor" });
    const own = await mkFile(editor.id, "own.png");
    const forged = await mkFile(outsider.id, "forged.png");
    const info = await mkFile(owner.id, "info.png");
    const sourceFile = await mkFile(owner.id, "doc.pdf");

    const deck = await mkArtifact(nb.id, owner.id, "slide_deck", {
      slides: [{ id: "a", image: { prompt: "", fileId: own.id } }, { id: "b", image: { prompt: "", fileId: forged.id } }],
      evidence: [],
    });
    const infographic = await mkArtifact(nb.id, owner.id, "infographic", { title: "t", blocks: [], imageFileId: info.id, evidence: [] });
    await db.insert(sources).values({ notebookId: nb.id, createdBy: owner.id, kind: "file", title: "s", fileId: sourceFile.id });

    await runBackfill();

    expect((await db.select().from(artifactFiles).where(eq(artifactFiles.artifactId, deck.id))).map((r) => r.fileId)).toEqual([own.id]);
    expect((await db.select().from(artifactFiles).where(eq(artifactFiles.artifactId, infographic.id))).map((r) => r.fileId)).toEqual([info.id]);
    const [src] = await db.select().from(files).where(eq(files.id, sourceFile.id));
    expect(src).toMatchObject({ notebookId: nb.id, origin: "source_upload" });
    const [img] = await db.select().from(files).where(eq(files.id, info.id));
    expect(img).toMatchObject({ notebookId: nb.id, origin: "artifact_image" });
    const [bad] = await db.select().from(files).where(eq(files.id, forged.id));
    expect(bad.notebookId).toBeNull();
  });

  it("artifact đang chứa trích đoạn nguồn riêng tư: gắn cờ, đưa về riêng tư và thu hồi share_token", async () => {
    const owner = await mkUser("owner2");
    const nb = await mkNotebook(owner.id);
    const [priv] = await db.insert(sources).values({ notebookId: nb.id, createdBy: owner.id, kind: "text", title: "p", visibility: "private" }).returning();
    const [shared] = await db.insert(sources).values({ notebookId: nb.id, createdBy: owner.id, kind: "text", title: "s", visibility: "shared" }).returning();
    const evidence = (sourceId: string) => ({ id: "e1", provider: "local", sourceId, sourceTitle: "t", locator: {}, text: "nguyên văn", score: 1 });
    const leaky = await mkArtifact(nb.id, owner.id, "report", { markdown: "x [1]", evidence: [evidence(priv.id)] }, { visibility: "link", shareToken: `tok-${"a".repeat(24)}` });
    const clean = await mkArtifact(nb.id, owner.id, "report", { markdown: "x [1]", evidence: [evidence(shared.id)] }, { visibility: "notebook" });

    await runBackfill();

    const [a] = await db.select().from(artifacts).where(eq(artifacts.id, leaky.id));
    expect(a).toMatchObject({ containsPrivateSources: true, visibility: "private", shareToken: null });
    const [b] = await db.select().from(artifacts).where(eq(artifacts.id, clean.id));
    expect(b).toMatchObject({ containsPrivateSources: false, visibility: "notebook" });
  });
});
