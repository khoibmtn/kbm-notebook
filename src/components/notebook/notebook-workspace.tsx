"use client";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { useNotebook } from "@/components/notebook/notebook-context";
import { useStoredFlag } from "@/lib/use-stored-flag";
import { useTeamUnread } from "@/lib/use-team-unread";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

function subscribeMedia(cb: () => void) {
  const mq = window.matchMedia("(min-width: 1024px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useIsDesktop() {
  return useSyncExternalStore(
    subscribeMedia,
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

type Props = {
  /** Cột trái: nguồn tri thức (320px, thu gọn 56px). */
  sources: ReactNode;
  /** Cột giữa: chat / notes / editor. */
  main: ReactNode;
  /** Cột phải: Studio (360px, thu gọn 56px). */
  studio: ReactNode;
  /** Chat nhóm: chỉ hiện thành tab "Nhóm" ở thanh dưới < 1024px (trên desktop dùng trang `/n/[id]/team`). */
  team?: ReactNode;
};

function Column({
  title,
  collapsed,
  onToggle,
  side,
  width,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  side: "left" | "right";
  width: number;
  children: ReactNode;
}) {
  const t = useT();
  const CollapseIcon = side === "left" ? ChevronsLeft : ChevronsRight;
  const ExpandIcon = side === "left" ? ChevronsRight : ChevronsLeft;
  return (
    <section
      aria-label={title}
      className={cn("flex shrink-0 flex-col border-border bg-background transition-[width]", side === "left" ? "border-r" : "border-l")}
      style={{ width: collapsed ? 56 : width }}
      data-collapsed={collapsed}
    >
      <div className={cn("flex h-11 shrink-0 items-center border-b px-3", collapsed ? "justify-center px-0" : "justify-between")}>
        {!collapsed && <h2 className="text-sm font-medium">{title}</h2>}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onToggle}
          aria-label={collapsed ? t("workspace.expand", { name: title }) : t("workspace.collapse", { name: title })}
        >
          {collapsed ? <ExpandIcon /> : <CollapseIcon />}
        </Button>
      </div>
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * Bố cục 3 cột kiểu NotebookLM: Sources (320) · Main (linh hoạt) · Studio (360).
 * < 1024px: gộp thành tab dưới cùng (Sources · Chat · Studio · Nhóm, có huy hiệu tin chưa đọc). Trạng thái thu gọn lưu ở localStorage.
 */
export function NotebookWorkspace({ sources, main, studio, team }: Props) {
  const t = useT();
  const { notebook, user } = useNotebook();
  const teamUnread = useTeamUnread(notebook.id, user.id);
  const isDesktop = useIsDesktop();
  const [sourcesCollapsed, toggleSources] = useStoredFlag("kbm:workspace:sources");
  const [studioCollapsed, toggleStudio] = useStoredFlag("kbm:workspace:studio");

  if (!isDesktop) {
    return (
      <Tabs defaultValue="chat" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsContent value="sources" className="min-h-0 flex-1 overflow-y-auto">
          {sources}
        </TabsContent>
        <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {main}
        </TabsContent>
        <TabsContent value="studio" className="min-h-0 flex-1 overflow-y-auto">
          {studio}
        </TabsContent>
        {team && (
          <TabsContent value="team" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {team}
          </TabsContent>
        )}
        <TabsList className="h-12 w-full shrink-0 rounded-none border-t bg-background">
          <TabsTrigger value="sources">{t("nav.sources")}</TabsTrigger>
          <TabsTrigger value="chat">{t("nav.chat")}</TabsTrigger>
          <TabsTrigger value="studio">{t("nav.studio")}</TabsTrigger>
          {team && (
            <TabsTrigger value="team" data-testid="mobile-tab-team">
              {t("nav.team")}
              {teamUnread > 0 && (
                <span
                  data-testid="mobile-team-unread-badge"
                  className="ml-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                  aria-label={t("team.unreadAria", { count: teamUnread })}
                >
                  {teamUnread > 99 ? "99+" : teamUnread}
                </span>
              )}
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>
    );
  }

  return (
    <div className="flex min-h-0 flex-1" data-testid="notebook-workspace">
      <Column title={t("nav.sources")} collapsed={sourcesCollapsed} onToggle={toggleSources} side="left" width={320}>
        {sources}
      </Column>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">{main}</div>
      <Column title={t("nav.studio")} collapsed={studioCollapsed} onToggle={toggleStudio} side="right" width={360}>
        {studio}
      </Column>
    </div>
  );
}
