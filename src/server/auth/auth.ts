import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { env, googleAuthEnabled } from "@/server/env";

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
