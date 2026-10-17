import { NotesPanel } from "@/components/notes/notes-panel";
import { getT } from "@/i18n/server";
import { isUuid } from "@/server/api/errors";

/** `/n/[id]/notes` — Ghi chú toàn trang; `?note=<id>` (liên kết từ thẻ ghi chú trong chat nhóm) mở thẳng ghi chú đó. */
export default async function NotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getT();
  const { note } = await searchParams;
  const noteId = typeof note === "string" && isUuid(note) ? note : null;
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-lg font-semibold">{t("nav.notes")}</h1>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-background">
        <NotesPanel key={noteId ?? "list"} initialNoteId={noteId} />
      </div>
    </div>
  );
}
