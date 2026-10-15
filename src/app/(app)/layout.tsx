import { requirePageSession } from "@/server/auth/page-session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requirePageSession();
  return <>{children}</>;
}
