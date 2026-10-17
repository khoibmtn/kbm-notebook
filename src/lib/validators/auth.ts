import { z } from "zod";
import type { TFunction } from "@/lib/i18n";

export const createLoginSchema = (t: TFunction) =>
  z.object({
    email: z.string().trim().min(1, t("validation.required")).email(t("validation.email")),
    password: z.string().min(1, t("validation.required")),
  });
export type LoginInput = z.infer<ReturnType<typeof createLoginSchema>>;

export const createRegisterSchema = (t: TFunction) =>
  z
    .object({
      name: z.string().trim().min(1, t("validation.required")).max(120),
      email: z.string().trim().min(1, t("validation.required")).email(t("validation.email")),
      password: z.string().min(8, t("validation.passwordMin", { min: 8 })).max(128),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: t("validation.passwordMatch") });
export type RegisterInput = z.infer<ReturnType<typeof createRegisterSchema>>;

/** Chỉ cho phép redirect nội bộ (chống open redirect). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
