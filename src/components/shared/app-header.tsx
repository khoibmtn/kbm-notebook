import { BookOpenText, Compass } from "lucide-react";
import Link from "next/link";
import { CommandPaletteTrigger } from "@/components/shared/command-palette";
import { NotificationBell } from "@/components/shared/notification-bell";
import { UserMenu, type MenuUser } from "@/components/shared/user-menu";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";

/** Thanh trên cho trang ngoài sổ tay (dashboard, cài đặt toàn cục). */
export async function AppHeader({ user }: { user: MenuUser }) {
  const t = await getT();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/90 px-4 backdrop-blur sm:px-6">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BookOpenText className="size-4" />
        </span>
        <span className="hidden sm:inline">{t("app.name")}</span>
      </Link>
      <div className="flex items-center gap-1">
        <Button asChild variant="ghost" size="sm" data-testid="nav-explore">
          <Link href="/explore" aria-label={t("nav.explore")}>
            <Compass /> <span className="hidden sm:inline">{t("nav.explore")}</span>
          </Link>
        </Button>
        <CommandPaletteTrigger />
        <NotificationBell />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
