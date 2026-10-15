import { NotesPanel } from "@/components/notes/notes-panel";
import { getT } from "@/i18n/server";

export default async function NotesPage() {
  const t = await getT();
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-lg font-semibold">{t("nav.notes")}</h1>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-background">
        <NotesPanel />
      </div>
    </div>
  );
}
