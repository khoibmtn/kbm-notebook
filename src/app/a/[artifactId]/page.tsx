import { FileX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { SharedArtifactView } from "@/components/studio/shared-artifact-view";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";
import { getNotebookRole } from "@/server/auth/permissions";
import { getSession } from "@/server/auth/session";
import { loadArtifactAccess, toDetailDto } from "@/server/artifacts/service";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Trang chỉ đọc `/a/[artifactId]`: artifact công khai (không cần đăng nhập) hoặc được chia sẻ riêng cho người dùng
 * ngoài sổ tay, kèm thích/bình luận. Thành viên sổ tay được chuyển sang trang artifact trong ứng dụng (trừ artifact công khai).
 */
export default async function PublicArtifactPage({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  const t = await getT();
  const session = await getSession().catch(() => null);

  let detail: Awaited<ReturnType<typeof toDetailDto>> | null = null;
  try {
    const access = await loadArtifactAccess(session?.user.id ?? null, artifactId);
    detail = await toDetailDto({ ...access, canEdit: false, canManage: false });
  } catch {
    detail = null;
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
  // Artifact công khai: thành viên cũng xem ở đây (có thích/bình luận); chia sẻ riêng: chuyển vào ứng dụng.
  if (member && detail.visibility !== "public") redirect(`/n/${detail.notebookId}/artifacts/${detail.id}`);
  return (
    <SharedArtifactView
      artifact={{ id: detail.id, type: detail.type, title: detail.title, content: detail.content, createdByName: detail.createdByName, updatedAt: detail.updatedAt }}
      signedIn={Boolean(session)}
      notebookId={member ? detail.notebookId : undefined}
      social={{ meId: session?.user.id ?? null }}
    />
  );
}
