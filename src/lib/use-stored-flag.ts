"use client";
import { useCallback, useSyncExternalStore } from "react";

const EVENT = "kbm:storage";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/**
 * Cờ boolean lưu trong localStorage (đồng bộ giữa tab); render server dùng `defaultValue`.
 * localStorage có thể ném lỗi (chế độ riêng tư) → luôn bọc try/catch.
 */
export function useStoredFlag(key: string, defaultValue = false): [boolean, () => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? defaultValue : raw === "1";
      } catch {
        return defaultValue;
      }
    },
    () => defaultValue,
  );
  const toggle = useCallback(() => {
    try {
      localStorage.setItem(key, value ? "0" : "1");
    } catch {
      /* bỏ qua */
    }
    window.dispatchEvent(new Event(EVENT));
  }, [key, value]);
  return [value, toggle];
}
