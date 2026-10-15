import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getArtifact } from "@/app/api/artifacts/[artifactId]/route";
import { POST as acceptInvite } from "@/app/api/invites/[token]/accept/route";
import { GET as listArtifacts } from "@/app/api/notebooks/[id]/artifacts/route";
import { POST as addShare } from "@/app/api/artifacts/[artifactId]/shares/route";
import { getAuth } from "@/server/auth/auth";
import { db } from "@/server/db";
import { artifactShares, notebookMembers, users } from "@/server/db/schema";
import { ConsoleEmailSender, getEmailSender, setEmailSender, SmtpEmailSender, type EmailMessage, type EmailSender } from "@/server/email";
import { emailVerificationRequired, resetEnvCache } from "@/server/env";
import { inviteMember } from "@/server/notebooks/service";
import type { ArtifactDto } from "@/lib/artifacts/meta";
import { createNotebookWithMembers, insertArtifact } from "../helpers/fixtures";
import { json } from "../helpers/team-chat";
import { createTestUser, makeRequest, params, type TestUser } from "../helpers/users";

const sent: EmailMessage[] = [];
const capture: EmailSender = {
  kind: "custom",
  async send(m) {
    sent.push(m);
  },
};

const ENV_KEYS = ["AUTH_REQUIRE_EMAIL_VERIFICATION", "SMTP_URL", "NODE_ENV"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else (process.env as Record<string, string>)[key] = value;
  resetEnvCache();
}
beforeAll(() => setEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "true"));
beforeEach(() => {
  sent.length = 0;
  setEmailSender(capture);
});
afterEach(() => setEmailSender(null));
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = saved[k]!;
  }
  resetEnvCache();
});

/** Đăng ký tài khoản (CHƯA xác minh), trả về link xác minh trong email đã gửi. */
async function signUp(name: string): Promise<{ user: TestUser; token: string; url: string }> {
  const user = await createTestUser(name);
  const mail = sent.find((m) => m.to === user.email);
  expect(mail, "phải có email xác minh").toBeDefined();
  const url = /https?:\/\/\S+/.exec(mail!.text)![0];
  return { user, url, token: new URL(url).searchParams.get("token")! };
}
const verify = (token: string) => getAuth().api.verifyEmail({ query: { token } });
const isVerified = async (id: string) => (await db.select({ v: users.emailVerified }).from(users).where(eq(users.id, id)))[0].v;

describe("H-4 · gửi email xác minh", () => {
  it("đăng ký gửi email tiếng Việt chứa liên kết xác minh; xác minh đặt email_verified", async () => {
    const { user, token, url } = await signUp("Người mới");
    const mail = sent.find((m) => m.to === user.email)!;
    expect(mail.subject).toBe("Xác minh email KBM Notebook");
    expect(url).toContain("/verify-email?token=");
    expect(await isVerified(user.id)).toBe(false);
    await verify(token);
    expect(await isVerified(user.id)).toBe(true);
  });

  it("tắt yêu cầu xác minh (dev/test) → không gửi email", async () => {
    setEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "false");
    try {
      const u = await createTestUser("Dev");
      expect(sent.find((m) => m.to === u.email)).toBeUndefined();
      expect(emailVerificationRequired()).toBe(false);
    } finally {
      setEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "true");
    }
  });

  it("mặc định: bật ở production, tắt ở dev/test; có thể ghi đè bằng biến môi trường", () => {
    setEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", undefined);
    setEnv("NODE_ENV", "production");
    expect(emailVerificationRequired()).toBe(true);
    setEnv("NODE_ENV", "development");
    expect(emailVerificationRequired()).toBe(false);
    setEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "false");
    setEnv("NODE_ENV", "production");
    expect(emailVerificationRequired()).toBe(false);
    setEnv("NODE_ENV", saved.NODE_ENV);
    setEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "true");
  });

  it("chọn sender: console mặc định, SMTP khi có SMTP_URL; console ghi liên kết ra log", async () => {
    setEmailSender(null);
    expect(getEmailSender()).toBeInstanceOf(ConsoleEmailSender);
    setEmailSender(null);
    setEnv("SMTP_URL", "smtp://user:pass@localhost:2525");
    expect(getEmailSender()).toBeInstanceOf(SmtpEmailSender);
    expect(getEmailSender().kind).toBe("smtp");
    setEmailSender(null);
    setEnv("SMTP_URL", undefined);

    const lines: string[] = [];
    await new ConsoleEmailSender((l) => lines.push(l)).send({ to: "a@b.c", subject: "S", text: "Liên kết: https://x/verify" });
    expect(lines.join("\n")).toContain("https://x/verify");
  });
});

describe("H-4 · lời mời theo email", () => {
  it("email chưa xác minh: mời không thêm thẳng; chấp nhận lời mời bị 403 cho tới khi xác minh", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    // Kẻ tấn công đăng ký trước bằng email của nạn nhân (chưa xác minh)
    const attacker = await signUp("Kẻ chiếm email");
    const res = await inviteMember({ notebookId: notebook.id, actorId: owner.id, actorRole: "owner", email: attacker.user.email, role: "editor" });
    expect(res.status).toBe("invited");
    const [member] = await db.select().from(notebookMembers).where(eq(notebookMembers.userId, attacker.user.id));
    expect(member).toBeUndefined();
    if (res.status !== "invited") throw new Error("unreachable");

    const denied = await acceptInvite(makeRequest("/x", { method: "POST", user: attacker.user }), params({ token: res.invite.token }));
    expect(denied.status).toBe(403);
    expect((await json(denied)).error.code).toBe("email_not_verified");
    expect(await db.select().from(notebookMembers).where(eq(notebookMembers.userId, attacker.user.id))).toHaveLength(0);

    // chủ email thật xác minh rồi mới chấp nhận được
    await verify(attacker.token);
    const ok = await acceptInvite(makeRequest("/x", { method: "POST", user: attacker.user }), params({ token: res.invite.token }));
    expect(ok.status).toBe(200);
    expect(await db.select().from(notebookMembers).where(eq(notebookMembers.userId, attacker.user.id))).toHaveLength(1);
  });

  it("email đã xác minh (hoặc Google) → mời thêm thẳng như trước", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const u = await signUp("Đã xác minh");
    await verify(u.token);
    const res = await inviteMember({ notebookId: notebook.id, actorId: owner.id, actorRole: "owner", email: u.user.email, role: "viewer" });
    expect(res.status).toBe("added");
    const google = await createTestUser("Google");
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, google.id)); // nhà cung cấp OAuth đã xác minh
    expect((await inviteMember({ notebookId: notebook.id, actorId: owner.id, actorRole: "owner", email: google.email, role: "viewer" })).status).toBe("added");
  });
});

describe("H-4 · chia sẻ artifact theo email", () => {
  it("chia sẻ cho email của tài khoản chưa xác minh không cấp quyền (xem, liệt kê) cho tới khi xác minh", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const art = await insertArtifact(notebook.id, owner.id, { visibility: "private" });
    const attacker = await signUp("Kẻ chiếm email");

    const res = await addShare(
      makeRequest(`/api/artifacts/${art.id}/shares`, { method: "POST", user: owner, body: { email: attacker.user.email, role: "edit" } }),
      params({ artifactId: art.id }),
    );
    expect(res.status).toBeLessThan(300);
    const [share] = await db.select().from(artifactShares).where(eq(artifactShares.artifactId, art.id));
    expect(share.userId).toBeNull(); // không gắn thẳng vào tài khoản chưa xác minh
    expect(share.email).toBe(attacker.user.email.toLowerCase());

    const view = () => getArtifact(makeRequest(`/api/artifacts/${art.id}`, { user: attacker.user }), params({ artifactId: art.id }));
    expect((await view()).status).toBe(404);

    // Không thấy trong danh sách của sổ tay; (cần là thành viên để liệt kê, nên kiểm tra bằng quyền xem)
    await verify(attacker.token);
    const after = await view();
    expect(after.status).toBe(200);
    const body = (await json(after)) as { artifact: ArtifactDto };
    expect(body.artifact.canEdit).toBe(true);
  });

  it("danh sách artifact của thành viên không gồm artifact private chia sẻ theo email khi email chưa xác minh", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const art = await insertArtifact(notebook.id, owner.id, { visibility: "private" });
    const u = await signUp("Thành viên chưa xác minh");
    await db.insert(notebookMembers).values({ notebookId: notebook.id, userId: u.user.id, role: "viewer" });
    await db.insert(artifactShares).values({ artifactId: art.id, email: u.user.email.toLowerCase(), role: "view" });
    const ids = async () =>
      ((await json(await listArtifacts(makeRequest(`/api/notebooks/${notebook.id}/artifacts`, { user: u.user }), params({ id: notebook.id })))) as { artifacts: ArtifactDto[] }).artifacts.map((a) => a.id);
    expect(await ids()).not.toContain(art.id);
    await verify(u.token);
    expect(await ids()).toContain(art.id);
  });
});
