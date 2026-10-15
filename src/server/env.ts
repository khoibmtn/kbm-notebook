import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  APP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "APP_ENCRYPTION_KEY phải là 32 byte dạng hex (64 ký tự)"),
  GEMINI_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(["gemini", "mock"]).default("gemini"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  STORAGE_DIR: z.string().default("./storage"),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Đọc & kiểm tra biến môi trường (lazy để build không cần .env đầy đủ). */
export function env(): Env {
  if (cached) return cached;
  const empty = (v: string | undefined) => (v && v.trim() !== "" ? v : undefined);
  const parsed = schema.safeParse({
    ...process.env,
    GEMINI_API_KEY: empty(process.env.GEMINI_API_KEY),
    GOOGLE_CLIENT_ID: empty(process.env.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: empty(process.env.GOOGLE_CLIENT_SECRET),
    AI_PROVIDER: empty(process.env.AI_PROVIDER),
    BETTER_AUTH_URL: empty(process.env.BETTER_AUTH_URL),
    NEXT_PUBLIC_APP_URL: empty(process.env.NEXT_PUBLIC_APP_URL),
    STORAGE_DIR: empty(process.env.STORAGE_DIR),
    MAX_UPLOAD_MB: empty(process.env.MAX_UPLOAD_MB),
    PORT: empty(process.env.PORT),
  });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Cấu hình môi trường không hợp lệ: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}

/** Chỉ dùng trong test: buộc đọc lại biến môi trường. */
export function resetEnvCache(): void {
  cached = null;
}

export function googleAuthEnabled(): boolean {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}
