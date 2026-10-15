"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Tập nguồn đang được chọn (dùng làm phạm vi cho Chat/Studio), lưu theo từng sổ tay trong localStorage
 * và đồng bộ giữa các component/tab.
 *
 * Dùng cho P2/P3:
 *   const { selectedIds } = useSourceSelection(notebookId);   // string[] ổn định giữa các lần render
 *   getSelectedSourceIds(notebookId)                          // đọc ngoài React
 */

const PREFIX = "kbm:sources:selected:";
const EMPTY: readonly string[] = Object.freeze([]);
/** `raw` = chuỗi JSON đã đọc/ghi gần nhất; so sánh để giữ nguyên tham chiếu mảng khi dữ liệu không đổi. */
const cache = new Map<string, { raw: string | null; ids: readonly string[]; persisted: boolean }>();
const listeners = new Set<() => void>();

function storageKey(notebookId: string) {
  return PREFIX + notebookId;
}

function read(notebookId: string): readonly string[] {
  let raw: string | null = null;
  let storageOk = true;
  try {
    raw = localStorage.getItem(storageKey(notebookId));
  } catch {
    storageOk = false; // localStorage không dùng được (chế độ riêng tư) → giữ trong bộ nhớ
  }
  const prev = cache.get(notebookId);
  if (raw === null) {
    // Chỉ dùng bản trong bộ nhớ khi không ghi/đọc được localStorage.
    if (prev && (!storageOk || !prev.persisted)) return prev.ids;
    if (prev) cache.delete(notebookId);
    return EMPTY;
  }
  if (prev && prev.raw === raw) return prev.ids; // giữ nguyên tham chiếu
  let ids: readonly string[] = EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    /* dữ liệu hỏng → coi như rỗng */
  }
  cache.set(notebookId, { raw, ids, persisted: true });
  return ids;
}

function write(notebookId: string, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  const raw = JSON.stringify(unique);
  let persisted = true;
  try {
    localStorage.setItem(storageKey(notebookId), raw);
  } catch {
    persisted = false;
  }
  cache.set(notebookId, { raw, ids: unique, persisted });
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(PREFIX)) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Đọc danh sách nguồn đã chọn ngoài React (chỉ chạy ở client). */
export function getSelectedSourceIds(notebookId: string): string[] {
  return [...read(notebookId)];
}

export function useSourceSelection(notebookId: string) {
  const selected = useSyncExternalStore(
    subscribe,
    () => read(notebookId),
    () => EMPTY,
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const isSelected = useCallback((id: string) => selectedSet.has(id), [selectedSet]);
  const toggle = useCallback(
    (id: string) => {
      const cur = read(notebookId);
      write(notebookId, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
    },
    [notebookId],
  );
  const add = useCallback((ids: string[]) => write(notebookId, [...read(notebookId), ...ids]), [notebookId]);
  const setAll = useCallback((ids: string[]) => write(notebookId, ids), [notebookId]);
  const clear = useCallback(() => write(notebookId, []), [notebookId]);
  /** Bỏ các id không còn tồn tại (nguồn đã xoá / không còn quyền xem). */
  const prune = useCallback(
    (validIds: string[]) => {
      const valid = new Set(validIds);
      const cur = read(notebookId);
      const next = cur.filter((id) => valid.has(id));
      if (next.length !== cur.length) write(notebookId, next);
    },
    [notebookId],
  );

  return { selectedIds: selected as string[], isSelected, toggle, add, setAll, clear, prune };
}

/** Đã từng có lựa chọn được lưu cho sổ tay này chưa (để chọn mặc định "tất cả" ở lần đầu). */
export function isSelectionInitialized(notebookId: string): boolean {
  try {
    return localStorage.getItem(storageKey(notebookId)) !== null;
  } catch {
    return cache.has(notebookId);
  }
}
