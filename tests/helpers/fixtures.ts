import { db } from "@/server/db";
import { artifacts, sources } from "@/server/db/schema";
import { createNotebook, addMember } from "@/server/notebooks/service";
import type { Role } from "@/server/db/schema";
import { createTestUser, type TestUser } from "./users";

/** Notebook + các thành viên theo vai trò. */
export async function createNotebookWithMembers(roles: Role[] = []) {
  const owner = await createTestUser("Chủ sổ tay");
  const notebook = await createNotebook(owner.id, { title: "Sổ tay test" });
  const members: Record<string, TestUser> = {};
  for (const role of roles) {
    const u = await createTestUser(`Thành viên ${role}`);
    await addMember(notebook.id, u.id, role, owner.id);
    members[role] = u;
  }
  return { owner, notebook, members };
}

export async function insertSource(
  notebookId: string,
  createdBy: string,
  over: Partial<typeof sources.$inferInsert> = {},
) {
  const [row] = await db
    .insert(sources)
    .values({ notebookId, createdBy, kind: "text", title: "Nguồn thử", rawText: "nội dung", ...over })
    .returning();
  return row;
}

export async function insertArtifact(
  notebookId: string,
  createdBy: string,
  over: Partial<typeof artifacts.$inferInsert> = {},
) {
  const [row] = await db
    .insert(artifacts)
    .values({ notebookId, createdBy, type: "report", title: "Artifact thử", status: "ready", ...over })
    .returning();
  return row;
}
