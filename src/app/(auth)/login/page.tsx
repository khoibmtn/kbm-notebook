import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { getT } from "@/i18n/server";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/validators/auth";
import { getSession } from "@/server/auth/session";
import { googleAuthEnabled } from "@/server/env";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("auth.login.title") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Session thật (không chỉ cookie): đã đăng nhập thì về trang đích; cookie hỏng/hết hạn thì ở lại để đăng nhập lại.
  if (await getSession().catch(() => null)) redirect(safeNext(next));
  return <LoginForm next={next} googleEnabled={googleAuthEnabled()} />;
}
