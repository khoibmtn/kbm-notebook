import { notFound } from "next/navigation";
import { ArtifactPage } from "@/components/studio/artifact-page";
import { ApiError, isUuid } from "@/server/api/errors";
import { requirePageSession } from "@/server/auth/page-session";
import { loadArtifactAccess } from "@/server/artifacts/service";

export default async function NotebookArtifactPage({ params }: { params: Promise<{ notebookId: string; artifactId: string }> }) {
  const { notebookId, artifactId } = await params;
  const { user } = await requirePageSession(`/n/${notebookId}/artifacts/${artifactId}`);
  if (!isUuid(notebookId) || !isUuid(artifactId)) notFound();
  try {
    // Artifact phải thuộc đúng sổ tay trên URL và người dùng phải được xem.
    await loadArtifactAccess(user.id, artifactId, { notebookId });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  return <ArtifactPage artifactId={artifactId} />;
}
