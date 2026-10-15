import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";

/** `/p/<slug>` sai hoặc sổ tay đã tắt công khai → HTTP 404. */
export default async function PublicNotebookNotFound() {
  const t = await getT();
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <EmptyState
        icon={SearchX}
        title={t("community.public.notFound")}
        description={t("community.public.notFoundDescription")}
        action={
          <Button asChild variant="outline">
            <Link href="/explore">{t("nav.explore")}</Link>
          </Button>
        }
      />
    </main>
  );
}
