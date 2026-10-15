import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth/register-form";
import { getT } from "@/i18n/server";
import { emailVerificationRequired, googleAuthEnabled } from "@/server/env";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("auth.register.title") };
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <RegisterForm next={next} googleEnabled={googleAuthEnabled()} verificationRequired={emailVerificationRequired()} />;
}
