import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth/register-form";
import { getT } from "@/i18n/server";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/validators/auth";
import { getSession } from "@/server/auth/session";
import { emailVerificationRequired, googleAuthEnabled } from "@/server/env";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("auth.register.title") };
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Session thật (không chỉ cookie): đã đăng nhập thì về trang đích; cookie hỏng/hết hạn thì ở lại để đăng nhập lại.
  if (await getSession().catch(() => null)) redirect(safeNext(next));
  return <RegisterForm next={next} googleEnabled={googleAuthEnabled()} verificationRequired={emailVerificationRequired()} />;
}
