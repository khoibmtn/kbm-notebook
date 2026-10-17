import type { Metadata } from "next";
import { NotebookGrid } from "@/components/dashboard/notebook-grid";
import { AppHeader } from "@/components/shared/app-header";
import { getT } from "@/i18n/server";
import { requirePageSession } from "@/server/auth/page-session";
import { listNotebooksForUser } from "@/server/notebooks/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("dashboard.title") };
}

export default async function DashboardPage() {
  const { user } = await requirePageSession();
  const notebooks = await listNotebooksForUser(user.id);
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        <NotebookGrid
          initial={notebooks.map((n) => ({
            ...n,
            createdAt: n.createdAt.toISOString(),
            updatedAt: n.updatedAt.toISOString(),
          }))}
        />
      </main>
    </div>
  );
}
