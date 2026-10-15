import type { Metadata } from "next";
import { SearchView } from "@/components/community/search-view";
import { AppHeader } from "@/components/shared/app-header";
import { getT } from "@/i18n/server";
import { isUuid } from "@/server/api/errors";
import { requirePageSession } from "@/server/auth/page-session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("search.title") };
}

/** `/search?q=…&notebook=<id>` — tìm kiếm toàn cục (sổ tay, nguồn, ghi chú, artifact, tin nhắn, cộng đồng). */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; notebook?: string }> }) {
  const { q, notebook } = await searchParams;
  const { user } = await requirePageSession(`/search${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
        <SearchView initialQuery={typeof q === "string" ? q.slice(0, 200) : ""} notebookId={notebook && isUuid(notebook) ? notebook : undefined} />
      </main>
    </div>
  );
}
