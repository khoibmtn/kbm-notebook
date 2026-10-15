import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { getT } from "@/i18n/server";
import { googleAuthEnabled } from "@/server/env";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("auth.login.title") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <LoginForm next={next} googleEnabled={googleAuthEnabled()} />;
}
