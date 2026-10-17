import { VerifyEmailBanner } from "@/components/auth/verify-email-banner";
import { CommandPalette } from "@/components/shared/command-palette";
import { requirePageSession } from "@/server/auth/page-session";
import { emailVerificationRequired } from "@/server/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePageSession();
  return (
    <>
      {/* Email chưa xác minh không dùng được làm danh tính (lời mời, chia sẻ theo email) — nhắc người dùng xác minh. */}
      {emailVerificationRequired() && !user.emailVerified && <VerifyEmailBanner email={user.email} />}
      {children}
      {/* Bảng lệnh ⌘K / Ctrl+K dùng được ở mọi trang đã đăng nhập (dashboard, sổ tay, cài đặt). */}
      <CommandPalette userId={user.id} />
    </>
  );
}
