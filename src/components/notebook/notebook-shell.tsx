"use client";
import {
  BookOpenText,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  FolderOpen,
  LayoutGrid,
  Menu,
  MessageSquare,
  Settings,
  Sparkles,
  Users,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useStoredFlag } from "@/lib/use-stored-flag";
import { MembersDialog } from "@/components/notebook/members-panel";
import { useNotebook } from "@/components/notebook/notebook-context";
import { NotebookTitle } from "@/components/notebook/notebook-title";
import { UserMenu } from "@/components/shared/user-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n-client";
import type { MessageKey } from "@/lib/i18n";
import { useRealtime } from "@/lib/realtime";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: MessageKey; icon: typeof FolderOpen; exact?: boolean };

function navItems(id: string): NavItem[] {
  const base = `/n/${id}`;
  return [
    { href: `${base}/sources`, label: "nav.sources", icon: FolderOpen },
    { href: base, label: "nav.chat", icon: MessageSquare, exact: true },
    { href: `${base}/notes`, label: "nav.notes", icon: FileText },
    { href: `${base}/studio`, label: "nav.studio", icon: Sparkles },
    { href: `${base}/team`, label: "nav.team", icon: UsersRound },
    { href: `${base}/members`, label: "nav.members", icon: Users },
    { href: `${base}/settings`, label: "nav.notebookSettings", icon: Settings },
  ];
}

const COLLAPSE_KEY = "kbm:sidebar-collapsed";

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const t = useT();
  const pathname = usePathname();
  const { notebook } = useNotebook();
  return (
    <nav aria-label={t("nav.notebookNav")} className="flex flex-col gap-1 p-2">
      {navItems(notebook.id).map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        const link = (
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              active && "bg-accent font-medium text-accent-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <item.icon className="size-4 shrink-0" />
            {!collapsed && <span className="truncate">{t(item.label)}</span>}
          </Link>
        );
        if (!collapsed) return <div key={item.href}>{link}</div>;
        return (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{t(item.label)}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

export function NotebookShell({ children }: { children: ReactNode }) {
  const t = useT();
  const { notebook, user } = useNotebook();
  const [collapsed, toggleCollapsed] = useStoredFlag(COLLAPSE_KEY);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const { joinNotebook, connected } = useRealtime();

  useEffect(() => {
    if (!connected) return;
    return joinNotebook(notebook.id);
  }, [connected, joinNotebook, notebook.id]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("nav.openMenu")}>
          <Menu />
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link href="/" aria-label={t("nav.backToDashboard")} className="hidden size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground sm:flex">
              <BookOpenText className="size-4" />
            </Link>
          </TooltipTrigger>
          <TooltipContent>{t("nav.backToDashboard")}</TooltipContent>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <NotebookTitle />
        </div>
        <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
          <Users /> <span className="hidden sm:inline">{t("notebook.share")}</span>
        </Button>
        <UserMenu user={user} />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "hidden shrink-0 flex-col border-r bg-muted/30 transition-[width] lg:flex",
            collapsed ? "w-14" : "w-56",
          )}
        >
          <div className="flex-1 overflow-y-auto">
            <SidebarNav collapsed={collapsed} />
          </div>
          <div className={cn("border-t p-2", collapsed && "flex justify-center")}>
            <Button
              variant="ghost"
              size={collapsed ? "icon" : "sm"}
              onClick={toggleCollapsed}
              aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
              className="text-muted-foreground"
            >
              {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
              {!collapsed && t("nav.collapse")}
            </Button>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2">
              <LayoutGrid className="size-4" /> {notebook.title}
            </SheetTitle>
          </SheetHeader>
          <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          <div className="mt-auto border-t p-2">
            <Link href="/" className="flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-accent">
              <BookOpenText className="size-4" /> {t("nav.backToDashboard")}
            </Link>
          </div>
        </SheetContent>
      </Sheet>

      <MembersDialog open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  );
}
