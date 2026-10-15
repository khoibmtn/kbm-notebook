import { notFound } from "next/navigation";
import { NotebookProvider } from "@/components/notebook/notebook-context";
import { NotebookShell } from "@/components/notebook/notebook-shell";
import { ApiError } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requirePageSession } from "@/server/auth/page-session";
import { getNotebook } from "@/server/notebooks/service";
import { isUuid } from "@/server/api/errors";

export default async function NotebookLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ notebookId: string }>;
}) {
  const { notebookId } = await params;
  const { user } = await requirePageSession(`/n/${notebookId}`);
  if (!isUuid(notebookId)) notFound();
  let role;
  try {
    role = await requireNotebookRole(user.id, notebookId, "viewer");
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const nb = await getNotebook(notebookId);
  return (
    <NotebookProvider
      value={{
        role,
        user: { id: user.id, name: user.name, email: user.email, image: user.image },
        notebook: {
          id: nb.id,
          title: nb.title,
          description: nb.description,
          emoji: nb.emoji,
          coverColor: nb.coverColor,
          systemInstruction: nb.systemInstruction,
          allowWeb: nb.allowWeb,
          defaultArtifactVisibility: nb.defaultArtifactVisibility,
          ownerId: nb.ownerId,
        },
      }}
    >
      <NotebookShell>{children}</NotebookShell>
    </NotebookProvider>
  );
}
