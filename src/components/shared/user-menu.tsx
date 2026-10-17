"use client";
import { Compass, LogOut, Monitor, Moon, Search, Settings, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/shared/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n-client";

export type MenuUser = { id: string; name: string; email: string; image?: string | null };

export function UserMenu({ user }: { user: MenuUser }) {
  const t = useT();
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  async function logout() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("nav.userMenu")}
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <UserAvatar name={user.name} image={user.image} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/explore">
            <Compass /> {t("nav.explore")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/search">
            <Search /> {t("nav.search")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=profile">
            <User /> {t("nav.profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> {t("nav.settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Sun /> {t("nav.theme")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light">
                <Sun className="size-4" /> {t("theme.light")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon className="size-4" /> {t("theme.dark")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor className="size-4" /> {t("theme.system")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout} variant="destructive">
          <LogOut /> {t("nav.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
