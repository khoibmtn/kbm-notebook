"use client";
import {
  BookOpen,
  FileText,
  FolderOpen,
  Hash,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Sparkles,
  StickyNote,
  Users,
  UsersRound,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CreateNotebookDialog } from "@/components/dashboard/create-notebook-dialog";
import { STUDIO_TYPES, TYPE_ICONS, TYPE_NAME_KEY } from "@/components/studio/type-meta";
import { channelTitle, sortChannels } from "@/components/team-chat/channel-utils";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { api, errorMessage } from "@/lib/api-client";
import type { ArtifactDto, ArtifactTypeName } from "@/lib/artifacts/meta";
import { useT } from "@/lib/i18n-client";
import type { NoteListItem } from "@/lib/notes";
import { hasRole, type Role } from "@/lib/roles";
import type { SourceDto } from "@/lib/sources";
import type { ChannelDTO } from "@/lib/team-chat/types";

/** Sự kiện để mở bảng lệnh từ nút bấm ở thanh trên (phím tắt ⌘K / Ctrl+K do `CommandPalette` tự lắng nghe). */
export const OPEN_COMMAND_PALETTE_EVENT = "kbm:open-command-palette";

const NOTEBOOK_PATH = /^\/n\/([0-9a-f-]{36})(?:\/|$)/i;

type NotebookRow = { id: string; title: string; description: string | null; emoji: string | null; role: Role };

type Loaded = {
  /** Lần mở bảng lệnh mà dữ liệu này thuộc về (tránh hiện dữ liệu cũ của lần mở trước). */
  openId: number;
  notebooks: NotebookRow[];
  sources: SourceDto[];
  notes: NoteListItem[];
  artifacts: ArtifactDto[];
  channels: ChannelDTO[];
};

const EMPTY = { notebooks: [], sources: [], notes: [], artifacts: [], channels: [] };

/** Bỏ dấu tiếng Việt + chữ thường để gõ "bao cao" vẫn khớp "Báo cáo". */
export function foldVi(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/** Mọi từ trong ô tìm kiếm phải xuất hiện (không phân biệt dấu) trong tiêu đề hoặc từ khoá của mục. */
export function paletteFilter(value: string, search: string, keywords?: string[]): number {
  const hay = foldVi(`${value} ${(keywords ?? []).join(" ")}`);
  const tokens = foldVi(search).split(/\s+/).filter(Boolean);
  return tokens.every((tk) => hay.includes(tk)) ? 1 : 0;
}

/** Nút mở bảng lệnh (đặt ở thanh trên). */
export function CommandPaletteTrigger({ className }: { className?: string }) {
  const t = useT();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
      aria-label={t("palette.open")}
      data-testid="palette-trigger"
    >
      <Search />
      <span className="hidden sm:inline">{t("palette.open")}</span>
      <kbd className="hidden rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground md:inline">⌘K</kbd>
    </Button>
  );
}

/**
 * Bảng lệnh toàn cục (⌘K / Ctrl+K): tìm sổ tay; khi đang ở trong một sổ tay còn tìm nguồn, ghi chú, artifact, kênh nhóm
 * và có hành động nhanh (Tạo sổ tay, Thêm nguồn, Tạo từng loại artifact). Dữ liệu lấy từ các API danh sách hiện có,
 * lọc ở máy khách (không phân biệt dấu).
 */
export function CommandPalette({ userId }: { userId: string }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const notebookId = NOTEBOOK_PATH.exec(pathname)?.[1] ?? null;

  const [open, setOpenState] = useState(false);
  /** Số lần đã mở: dữ liệu tải về gắn với lần mở của nó nên không bao giờ hiện dữ liệu cũ. */
  const [openCount, setOpenCount] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  /** Nội dung ô tìm của bảng lệnh — dùng cho mục "Tìm toàn bộ…" (chuyển sang /search?q=). */
  const [searchText, setSearchText] = useState("");
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const setOpen = useCallback((o: boolean) => {
    setOpenState(o);
    if (o) {
      setOpenCount((c) => c + 1);
      setSearchText("");
    }
  }, []);
  const data = loaded && loaded.openId === openCount ? loaded : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!openRef.current);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    };
  }, [setOpen]);

  // Tải dữ liệu mỗi lần mở (danh sách luôn mới; lỗi một nhóm không làm hỏng các nhóm khác).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      const nb = notebookId;
      const [notebooks, sources, notes, artifacts, channels] = await Promise.allSettled([
        api<{ notebooks: NotebookRow[] }>("/api/notebooks"),
        nb ? api<{ sources: SourceDto[] }>(`/api/notebooks/${nb}/sources`) : Promise.resolve({ sources: [] as SourceDto[] }),
        nb ? api<{ notes: NoteListItem[] }>(`/api/notebooks/${nb}/notes`) : Promise.resolve({ notes: [] as NoteListItem[] }),
        nb ? api<{ artifacts: ArtifactDto[] }>(`/api/notebooks/${nb}/artifacts`) : Promise.resolve({ artifacts: [] as ArtifactDto[] }),
        nb ? api<{ channels: ChannelDTO[] }>(`/api/notebooks/${nb}/channels`) : Promise.resolve({ channels: [] as ChannelDTO[] }),
      ]);
      if (cancelled) return;
      setLoaded({
        openId: openCount,
        notebooks: notebooks.status === "fulfilled" ? notebooks.value.notebooks : EMPTY.notebooks,
        sources: sources.status === "fulfilled" ? sources.value.sources : EMPTY.sources,
        notes: notes.status === "fulfilled" ? notes.value.notes : EMPTY.notes,
        artifacts: artifacts.status === "fulfilled" ? artifacts.value.artifacts : EMPTY.artifacts,
        channels: channels.status === "fulfilled" ? sortChannels(channels.value.channels) : EMPTY.channels,
      });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, openCount, notebookId]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router, setOpen],
  );

  const role = useMemo(() => data?.notebooks.find((n) => n.id === notebookId)?.role ?? null, [data, notebookId]);
  const canEdit = hasRole(role, "editor");

  const createArtifact = useCallback(
    async (type: ArtifactTypeName) => {
      if (!notebookId) return;
      setOpen(false);
      const name = t(TYPE_NAME_KEY[type]);
      const id = toast.loading(t("studio.toast.creating", { name }));
      try {
        const res = await api<{ artifact: ArtifactDto }>(`/api/notebooks/${notebookId}/artifacts`, { method: "POST", json: { type } });
        toast.success(t("studio.toast.creating", { name }), { id });
        router.push(`/n/${notebookId}/artifacts/${res.artifact.id}`);
      } catch (e) {
        toast.error(errorMessage(e, t("common.error")), { id });
      }
    },
    [notebookId, router, setOpen, t],
  );

  const base = notebookId ? `/n/${notebookId}` : null;

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen} title={t("palette.title")} description={t("palette.description")} className="sm:max-w-xl" filter={paletteFilter}>
        <div data-testid="command-palette">
          <CommandInput placeholder={t("palette.placeholder")} value={searchText} onValueChange={setSearchText} data-testid="palette-input" />
          <CommandList className="max-h-[min(24rem,60vh)]">
            {!data ? (
              <p className="py-6 text-center text-sm text-muted-foreground" role="status">
                {t("common.loading")}
              </p>
            ) : (
              <>
                <CommandEmpty>{t("palette.empty")}</CommandEmpty>

                <CommandGroup heading={t("palette.group.actions")}>
                  <CommandItem
                    value={t("palette.action.createNotebook")}
                    keywords={["tao so tay", "new notebook", "create notebook"]}
                    onSelect={() => {
                      setOpen(false);
                      setCreateOpen(true);
                    }}
                    data-testid="palette-create-notebook"
                  >
                    <Plus /> {t("palette.action.createNotebook")}
                  </CommandItem>
                  {base && canEdit && (
                    <CommandItem value={t("palette.action.addSource")} keywords={["them nguon", "add source", "upload"]} onSelect={() => go(`${base}/sources?add=1`)} data-testid="palette-add-source">
                      <FolderOpen /> {t("palette.action.addSource")}
                    </CommandItem>
                  )}
                  {base &&
                    canEdit &&
                    STUDIO_TYPES.map((type) => {
                      const Icon = TYPE_ICONS[type];
                      const name = t(TYPE_NAME_KEY[type]);
                      return (
                        <CommandItem key={type} value={t("studio.createType", { name })} keywords={["tao artifact", "create", type]} onSelect={() => void createArtifact(type)} data-testid={`palette-create-${type}`}>
                          <Icon /> {t("studio.createType", { name })}
                        </CommandItem>
                      );
                    })}
                </CommandGroup>

                {base && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading={t("palette.group.goto")}>
                      {[
                        { href: base, label: t("nav.chat"), icon: MessageSquare },
                        { href: `${base}/sources`, label: t("nav.sources"), icon: FolderOpen },
                        { href: `${base}/notes`, label: t("nav.notes"), icon: FileText },
                        { href: `${base}/studio`, label: t("nav.studio"), icon: Sparkles },
                        { href: `${base}/team`, label: t("nav.team"), icon: UsersRound },
                        { href: `${base}/members`, label: t("nav.members"), icon: Users },
                        { href: `${base}/settings`, label: t("nav.notebookSettings"), icon: Settings },
                      ].map((it) => (
                        <CommandItem key={it.href} value={`${t("palette.goto")} ${it.label}`} onSelect={() => go(it.href)}>
                          <it.icon /> {it.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                {data.notebooks.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading={t("palette.group.notebooks")}>
                      {data.notebooks.map((n) => (
                        <CommandItem key={n.id} value={`nb:${n.id} ${n.title}`} keywords={[n.description ?? ""]} onSelect={() => go(`/n/${n.id}`)} data-testid="palette-notebook">
                          <span className="w-4 text-center text-sm leading-none" aria-hidden>
                            {n.emoji ?? <BookOpen className="size-4" />}
                          </span>
                          <span className="truncate">{n.title}</span>
                          {n.id === notebookId && <span className="ml-auto text-xs text-muted-foreground">{t("palette.current")}</span>}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                {base && data.sources.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading={t("palette.group.sources")}>
                      {data.sources.map((s) => (
                        <CommandItem key={s.id} value={`src:${s.id} ${s.title}`} keywords={[s.summary ?? "", ...(s.keyTopics ?? [])]} onSelect={() => go(`${base}/sources?source=${s.id}`)} data-testid="palette-source">
                          <FolderOpen /> <span className="truncate">{s.title}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                {base && data.notes.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading={t("palette.group.notes")}>
                      {data.notes.map((n) => {
                        const title = n.title;
                        return (
                          <CommandItem key={n.id} value={`note:${n.id} ${title}`} keywords={[n.excerpt]} onSelect={() => go(`${base}/notes?note=${n.id}`)} data-testid="palette-note">
                            <StickyNote /> <span className="truncate">{title}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </>
                )}

                {base && data.artifacts.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading={t("palette.group.artifacts")}>
                      {data.artifacts.map((a) => {
                        const Icon = TYPE_ICONS[a.type];
                        return (
                          <CommandItem key={a.id} value={`art:${a.id} ${a.title}`} keywords={[t(TYPE_NAME_KEY[a.type])]} onSelect={() => go(`${base}/artifacts/${a.id}`)} data-testid="palette-artifact">
                            <Icon /> <span className="truncate">{a.title}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{t(TYPE_NAME_KEY[a.type])}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </>
                )}

                {base && data.channels.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading={t("palette.group.channels")}>
                      {data.channels.map((c) => {
                        const title = channelTitle(c, userId, t);
                        return (
                          <CommandItem key={c.id} value={`ch:${c.id} ${title}`} onSelect={() => go(`${base}/team?channel=${c.id}`)} data-testid="palette-channel">
                            {c.type === "general" ? <UsersRound /> : <Hash />} <span className="truncate">{title}</span>
                            {c.unread > 0 && <span className="ml-auto text-xs font-medium text-primary">{c.unread}</span>}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </>
                )}

                <CommandSeparator alwaysRender />
                <CommandGroup forceMount>
                  <CommandItem
                    forceMount
                    value="__search_all__"
                    onSelect={() => go(searchText.trim() ? `/search?q=${encodeURIComponent(searchText.trim())}` : "/search")}
                    data-testid="palette-search-all"
                  >
                    <Search />
                    <span className="truncate">{searchText.trim() ? t("palette.searchAllFor", { query: searchText.trim() }) : t("palette.searchAll")}</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </div>
      </CommandDialog>
      <CreateNotebookDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
