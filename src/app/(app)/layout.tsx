import { CommandPalette } from "@/components/shared/command-palette";
import { requirePageSession } from "@/server/auth/page-session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePageSession();
  return (
    <>
      {children}
      {/* Bảng lệnh ⌘K / Ctrl+K dùng được ở mọi trang đã đăng nhập (dashboard, sổ tay, cài đặt). */}
      <CommandPalette userId={user.id} />
    </>
  );
}
