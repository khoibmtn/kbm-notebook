"use client";
import { useEffect, useState } from "react";
import { ChatPanel, OPEN_NOTES_EVENT } from "@/components/chat/chat-panel";
import { NotesPanel } from "@/components/notes/notes-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n-client";
import type { NoteDto } from "@/lib/notes";

type Props = {
  /** Móc "Chia sẻ ghi chú vào chat nhóm" (P4 truyền vào). */
  onShareNoteToChat?: (note: NoteDto) => void;
};

/**
 * Cột giữa của `/n/[id]`: hai tab "Trò chuyện" · "Ghi chú". Tab Trò chuyện luôn được giữ (ẩn khi không chọn)
 * để không mất câu trả lời đang stream; tab Ghi chú tải lại mỗi lần mở.
 */
export function MainTabs({ onShareNoteToChat }: Props) {
  const t = useT();
  const [tab, setTab] = useState<"chat" | "notes">("chat");
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);

  // "Lưu thành ghi chú" trong chat → chuyển sang tab Ghi chú và mở ghi chú vừa tạo.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const noteId = (e as CustomEvent<{ noteId?: string }>).detail?.noteId ?? null;
      setOpenNoteId(noteId);
      setTab("notes");
    };
    window.addEventListener(OPEN_NOTES_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTES_EVENT, onOpen);
  }, []);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "chat" | "notes")} className="min-h-0 flex-1 gap-0">
      <div className="flex shrink-0 items-center border-b px-3 py-1.5">
        <TabsList className="h-8">
          <TabsTrigger value="chat" className="px-3 text-xs" data-testid="tab-chat">
            {t("chat.tab.chat")}
          </TabsTrigger>
          <TabsTrigger value="notes" className="px-3 text-xs" data-testid="tab-notes">
            {t("chat.tab.notes")}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="chat" forceMount className="flex min-h-0 flex-col data-[state=inactive]:hidden">
        <ChatPanel />
      </TabsContent>
      <TabsContent value="notes" className="flex min-h-0 flex-col">
        <NotesPanel key={openNoteId ?? "list"} initialNoteId={openNoteId} onShareToChat={onShareNoteToChat} compact />
      </TabsContent>
    </Tabs>
  );
}
