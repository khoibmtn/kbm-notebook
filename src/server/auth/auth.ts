import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { emailVerificationRequired, env, googleAuthEnabled } from "@/server/env";
import { getEmailSender } from "@/server/email";
import { t } from "@/lib/i18n";

/** Scope Drive chỉ xin khi người dùng chủ động bấm "Kết nối Google Drive" (linkSocial). */
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

function buildAuth() {
  const e = env();
  const trusted = new Set<string>([e.BETTER_AUTH_URL, e.NEXT_PUBLIC_APP_URL]);
  const extra = process.env.TRUSTED_ORIGINS;
  if (extra) extra.split(",").forEach((o) => o.trim() && trusted.add(o.trim()));

  return betterAuth({
    appName: "KBM Notebook",
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [...trusted],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    advanced: { database: { generateId: "uuid" } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    // Xác minh email (H-4). Không chặn đăng nhập (người dùng vẫn dùng sổ tay của mình), nhưng email chưa xác minh
    // không được dùng làm danh tính: lời mời theo email, chia sẻ artifact theo email, chấp nhận lời mời bằng liên kết.
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        // Dev/test (AUTH_REQUIRE_EMAIL_VERIFICATION=false): không gửi, tránh ồn log.
        if (!emailVerificationRequired()) return;
        const text = t("email.verify.body", { name: user.name, url });
        void getEmailSender()
          .send({ to: user.email, subject: t("email.verify.subject"), text })
          .catch((err: unknown) => console.error("[email] gửi email xác minh thất bại:", err instanceof Error ? err.message : err));
      },
    },
    socialProviders: googleAuthEnabled()
      ? {
          google: {
            clientId: e.GOOGLE_CLIENT_ID as string,
            clientSecret: e.GOOGLE_CLIENT_SECRET as string,
            // scope mặc định: openid email profile. Drive được xin thêm sau (linkSocial với scopes).
            scope: ["openid", "email", "profile"],
            accessType: "offline",
            prompt: "select_account consent",
          },
        }
      : {},
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Tạo hồ sơ + cài đặt mặc định cho người dùng mới.
            await db
              .insert(schema.userProfiles)
              .values({ userId: user.id, displayName: user.name })
              .onConflictDoNothing();
            await db.insert(schema.userSettings).values({ userId: user.id }).onConflictDoNothing();
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof buildAuth>;

const g = globalThis as unknown as { __kbmAuth?: Auth };

/** Singleton better-auth (dùng chung giữa các lần hot-reload). */
export function getAuth(): Auth {
  return (g.__kbmAuth ??= buildAuth());
}
