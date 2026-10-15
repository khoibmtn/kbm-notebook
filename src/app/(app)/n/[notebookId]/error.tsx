"use client";
import { ErrorPanel } from "@/components/shared/error-panel";

/** Ranh giới lỗi trong không gian sổ tay: khung sổ tay (thanh trên, điều hướng) vẫn còn, chỉ phần nội dung báo lỗi. */
export default function NotebookError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel error={error} reset={reset} titleKey="error.notebook.title" homeKey="error.notebook.back" />;
}
