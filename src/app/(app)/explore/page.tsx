import type { Metadata } from "next";
import { ExploreView, type ExploreTab } from "@/components/community/explore-view";
import { AppHeader } from "@/components/shared/app-header";
import { getT } from "@/i18n/server";
import { requirePageSession } from "@/server/auth/page-session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("community.explore.title") };
}

const TABS: ExploreTab[] = ["artifacts", "notebooks", "groups"];

/** `/explore` — Khám phá cộng đồng: artifact, sổ tay, nhóm công khai. `?tab=notebooks|groups`. */
export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user } = await requirePageSession("/explore");
  const { tab } = await searchParams;
  const initialTab = TABS.find((t) => t === tab) ?? "artifacts";
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        <ExploreView initialTab={initialTab} />
      </main>
    </div>
  );
}
