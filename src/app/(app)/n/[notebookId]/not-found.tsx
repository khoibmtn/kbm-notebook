import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";

/** `notFound()` trong các trang con của sổ tay (nguồn/artifact không tồn tại...). */
export default async function NotebookNotFound() {
  const t = await getT();
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center p-6">
      <EmptyState
        icon={SearchX}
        title={t("error.notebook.notFound")}
        description={t("error.notebook.notFoundDescription")}
        action={
          <Button asChild variant="outline">
            <Link href="/">{t("error.notebook.back")}</Link>
          </Button>
        }
      />
    </div>
  );
}
