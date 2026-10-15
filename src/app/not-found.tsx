import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="flex min-h-screen items-center justify-center">
      <EmptyState
        icon={SearchX}
        title={t("notFound.title")}
        description={t("notFound.description")}
        action={
          <Button asChild>
            <Link href="/">{t("nav.backToDashboard")}</Link>
          </Button>
        }
      />
    </main>
  );
}
