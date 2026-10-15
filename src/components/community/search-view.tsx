"use client";
import { BookOpen, FileText, FolderOpen, Globe, Hash, Loader2, MessageSquare, Search, Sparkles, StickyNote, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { TYPE_ICONS, TYPE_NAME_KEY } from "@/components/studio/type-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { isArtifactTypeName } from "@/lib/artifacts/content";
import { SEARCH_TYPES, splitHighlight, type SearchResponseDto, type SearchResultDto, type SearchType } from "@/lib/community";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import type { MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const GROUP_ICONS: Record<SearchType, typeof Search> = {
  notebooks: BookOpen,
  sources: FolderOpen,
  notes: StickyNote,
  artifacts: Sparkles,
  messages: MessageSquare,
  public: Globe,
};

/** Hiển thị chuỗi có đánh dấu khớp bằng `<mark>` (không dùng dangerouslySetInnerHTML). */
export function Highlighted({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {splitHighlight(text).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-warning/30 px-0.5 text-foreground">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

function ResultIcon({ r }: { r: SearchResultDto }) {
  if ((r.type === "artifacts" || r.type === "public") && r.meta.kind && isArtifactTypeName(r.meta.kind)) {
    const Icon = TYPE_ICONS[r.meta.kind];
    return <Icon className="size-4" aria-hidden />;
  }
  if (r.type === "messages") return r.meta.kind === "dm" ? <MessageSquare className="size-4" aria-hidden /> : <Hash className="size-4" aria-hidden />;
  if (r.type === "notebooks") return <span aria-hidden>{r.meta.kind ?? "📓"}</span>;
  const Icon = r.type === "sources" ? FileText : GROUP_ICONS[r.type];
  return <Icon className="size-4" aria-hidden />;
}

function metaLine(r: SearchResultDto, t: ReturnType<typeof useT>, locale: "vi" | "en"): string {
  const parts: string[] = [];
  if (r.notebookTitle && r.type !== "notebooks") parts.push(t("search.in", { notebook: r.notebookTitle }));
  if ((r.type === "artifacts" || r.type === "public") && r.meta.kind && isArtifactTypeName(r.meta.kind)) parts.push(t(TYPE_NAME_KEY[r.meta.kind]));
  if (r.type === "sources" && r.meta.page) parts.push(t("search.page", { page: r.meta.page }));
  if (r.type === "messages") parts.push(r.meta.channel ? t("search.channel", { name: r.meta.channel }) : t("search.dm"));
  if (r.type === "public" && r.meta.author) parts.push(r.meta.author);
  if (r.meta.createdAt && (r.type === "messages" || r.type === "public" || r.type === "notes" || r.type === "artifacts")) parts.push(formatRelative(r.meta.createdAt, locale));
  return parts.join(" · ");
}

/** Trang tìm kiếm toàn cục `/search?q=`: nhóm kết quả, đoạn trích đánh dấu, điều hướng bằng bàn phím. */
export function SearchView({ initialQuery, notebookId }: { initialQuery: string; notebookId?: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery.trim());
  const [filter, setFilter] = useState<SearchType | "all">("all");
  const [data, setData] = useState<SearchResponseDto | null>(null);
  const [loading, setLoading] = useState(Boolean(initialQuery.trim()));
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const commit = useCallback(
    (value: string) => {
      const q = value.trim();
      setQuery(q);
      setActive(0);
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (notebookId) params.set("notebook", notebookId);
      window.history.replaceState(null, "", `/search${params.size ? `?${params.toString()}` : ""}`);
    },
    [notebookId],
  );

  // Gõ → tự tìm sau 400ms.
  useEffect(() => {
    const id = setTimeout(() => {
      if (input.trim() !== query) commit(input);
    }, 400);
    return () => clearTimeout(id);
  }, [input, query, commit]);

  useEffect(() => {
    if (!query) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ q: query, limit: "10" });
    if (notebookId) qs.set("notebookId", notebookId);
    api<SearchResponseDto>(`/api/search?${qs.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(errorMessage(e, t("search.error")));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, notebookId, t]);

  const groups = useMemo(() => {
    if (!data) return [];
    return SEARCH_TYPES.filter((k) => filter === "all" || filter === k)
      .map((k) => ({ type: k, items: data.groups[k] }))
      .filter((g) => g.items.length > 0);
  }, [data, filter]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const total = data ? SEARCH_TYPES.reduce((n, k) => n + data.groups[k].length, 0) : 0;

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-result-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, flat]);

  // "/" → quay lại ô tìm kiếm (khi không đang gõ trong ô nhập khác).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && !(e.target as HTMLElement | null)?.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && input.trim() === query) {
      const r = flat[Math.min(active, flat.length - 1)];
      if (r) {
        e.preventDefault();
        router.push(r.href);
      }
    }
  }

  let runningIndex = -1;
  return (
    <div className="space-y-5" onKeyDown={onKeyDown}>
      <h1 className="text-xl font-semibold">{t("search.title")}</h1>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() !== query) commit(input);
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="pl-8"
            autoFocus
            maxLength={200}
            data-testid="search-input"
          />
        </div>
        <Button type="submit" data-testid="search-submit">
          {t("search.submit")}
        </Button>
      </form>
      {notebookId && <p className="text-xs text-muted-foreground">{t("search.scope")}</p>}

      {data && total > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("search.title")}>
          {(["all", ...SEARCH_TYPES] as const)
            .filter((k) => k === "all" || data.groups[k].length > 0)
            .map((k) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant={filter === k ? "default" : "outline"}
                onClick={() => {
                  setFilter(k);
                  setActive(0);
                }}
                aria-pressed={filter === k}
                data-testid={`search-filter-${k}`}
              >
                {k === "all" ? `${t("search.filter.all")} (${total})` : `${t(`search.group.${k}` as MessageKey)} (${data.groups[k].length})`}
              </Button>
            ))}
        </div>
      )}

      {!query ? (
        <EmptyState icon={Search} title={t("search.hint")} className="py-16" />
      ) : loading && !data ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" /> {t("search.loading")}
        </p>
      ) : error ? (
        <p className="py-8 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : data && flat.length === 0 ? (
        <EmptyState icon={Search} title={t("search.empty", { query: data.query })} className="py-16" />
      ) : (
        <div className={cn("space-y-6", loading && "opacity-60")} aria-busy={loading} aria-label={t("search.results.aria")} data-testid="search-results">
          {groups.map((g) => {
            const GroupIcon = GROUP_ICONS[g.type];
            return (
              <section key={g.type} aria-labelledby={`sg-${g.type}`} data-testid={`search-group-${g.type}`}>
                <h2 id={`sg-${g.type}`} className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <GroupIcon className="size-4" aria-hidden /> {t(`search.group.${g.type}` as MessageKey)}
                  <span className="font-normal">({g.items.length})</span>
                </h2>
                <ul className="divide-y rounded-xl border bg-card">
                  {g.items.map((r) => {
                    runningIndex += 1;
                    const idx = runningIndex;
                    const isActive = idx === active;
                    return (
                      <li key={`${r.type}:${r.id}`}>
                        <Link
                          href={r.href}
                          data-result-index={idx}
                          data-active={isActive || undefined}
                          data-testid="search-result"
                          onMouseMove={() => setActive(idx)}
                          className={cn("flex gap-3 p-3 outline-none first:rounded-t-xl last:rounded-b-xl focus-visible:ring-2 focus-visible:ring-ring", isActive ? "bg-accent" : "hover:bg-accent/50")}
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
                            {r.type === "public" ? <UsersRound className="size-4" aria-hidden /> : <ResultIcon r={r} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              <Highlighted text={r.type === "messages" ? r.title : r.titleHl} />
                            </span>
                            {r.snippet && (
                              <span className="mt-0.5 line-clamp-2 block break-words text-sm text-muted-foreground">
                                <Highlighted text={r.snippet} />
                              </span>
                            )}
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{metaLine(r, t, locale)}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          <p className="text-xs text-muted-foreground">{t("search.keyboard")}</p>
        </div>
      )}
    </div>
  );
}
