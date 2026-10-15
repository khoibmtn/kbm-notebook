"use client";
import { ErrorPanel } from "@/components/shared/error-panel";

/** Ranh giới lỗi cho các trang đã đăng nhập (dashboard, cài đặt, Explore, tìm kiếm, nhóm). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel error={error} reset={reset} className="flex min-h-screen items-center justify-center p-6" />;
}
