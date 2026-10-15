import { FileX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { SharedArtifactView } from "@/components/studio/shared-artifact-view";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";
import { getNotebookRole } from "@/server/auth/permissions";
import { getSession } from "@/server/auth/session";
import { findArtifactByToken, loadArtifactAccess, toDetailDto } from "@/server/artifacts/service";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Trang chỉ đọc `/s/[token]` cho artifact ở chế độ "Ai có liên kết" (hoặc công khai) — không cần đăng nhập. */
export default async function SharedArtifactPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getT();
  const session = await getSession().catch(() => null);
  const row = await findArtifactByToken(token);

  let detail: Awaited<ReturnType<typeof toDetailDto>> | null = null;
  if (row && (row.visibility === "link" || row.visibility === "public")) {
    try {
      const access = await loadArtifactAccess(session?.user.id ?? null, row.id, { shareToken: token });
      detail = await toDetailDto({ ...access, canEdit: false, canManage: false });
    } catch {
      detail = null;
    }
  }

  if (!detail) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <EmptyState
          icon={FileX}
          title={t("studio.shared.invalid.title")}
          description={t("studio.shared.invalid.description")}
          action={
            <Button asChild variant="outline">
              <Link href="/">{t("nav.backToDashboard")}</Link>
            </Button>
          }
        />
      </main>
    );
  }
  const member = session ? (await getNotebookRole(session.user.id, detail.notebookId)) !== null : false;
  return (
    <SharedArtifactView
      artifact={{ id: detail.id, type: detail.type, title: detail.title, content: detail.content, createdByName: detail.createdByName, updatedAt: detail.updatedAt }}
      signedIn={Boolean(session)}
      notebookId={member ? detail.notebookId : undefined}
    />
  );
}
