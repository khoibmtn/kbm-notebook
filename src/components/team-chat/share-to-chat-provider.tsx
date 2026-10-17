"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useNotebook } from "@/components/notebook/notebook-context";
import { ShareToChatDialog, type ShareItem } from "./share-to-chat-dialog";

type ShareFn = (item: ShareItem) => void;

const ShareToChatContext = createContext<ShareFn | null>(null);

/**
 * Một hộp "Chia sẻ vào chat" dùng chung cho cả sổ tay (Ghi chú, Studio, Nguồn…): nơi nào cũng chỉ cần
 * `const share = useShareToChat(); share?.({ type: "note", id, title })`. Phải nằm trong `NotebookProvider`.
 */
export function ShareToChatProvider({ children }: { children: ReactNode }) {
  const { notebook } = useNotebook();
  const [item, setItem] = useState<ShareItem | null>(null);
  const share = useCallback<ShareFn>((i) => setItem(i), []);
  const value = useMemo(() => share, [share]);
  return (
    <ShareToChatContext.Provider value={value}>
      {children}
      {item && <ShareToChatDialog open onOpenChange={(o) => !o && setItem(null)} notebookId={notebook.id} item={item} />}
    </ShareToChatContext.Provider>
  );
}

/** Hàm mở hộp "Chia sẻ vào chat"; `null` khi không có provider (vd. trang chia sẻ công khai, test riêng lẻ) → ẩn mục menu. */
export function useShareToChat(): ShareFn | null {
  return useContext(ShareToChatContext);
}
