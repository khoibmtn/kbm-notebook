"use client";
import { Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import { toPlainPreview } from "@/lib/team-chat/markdown";
import type { ChannelType, MessageDTO } from "@/lib/team-chat/types";
import { cn } from "@/lib/utils";

export type SearchResult = MessageDTO & { channelName: string | null; channelType: ChannelType };

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const at = lower.indexOf(needle, i);
    if (at === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (at > i) parts.push(text.slice(i, at));
    parts.push(
      <mark key={k++} className="rounded bg-amber-400/40 px-0.5 text-foreground">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    i = at + needle.length;
  }
  return <>{parts}</>;
}

/** Tìm tin nhắn trong kênh hiện tại hoặc mọi kênh của mình; bấm kết quả để nhảy tới tin. */
export function SearchPanel({
  notebookId,
  channelId,
  channelLabel,
  onClose,
  onPick,
}: {
  notebookId: string;
  channelId: string;
  channelLabel: string;
  onClose: () => void;
  onPick: (r: SearchResult) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const my = ++seq.current;
    const handle = setTimeout(() => {
      setLoading(true);
      const url = all
        ? `/api/notebooks/${notebookId}/messages/search?q=${encodeURIComponent(query)}`
        : `/api/channels/${channelId}/messages/search?q=${encodeURIComponent(query)}`;
      api<{ results: SearchResult[] }>(url)
        .then((res) => {
          if (my === seq.current) setResults(res.results);
        })
        .catch(() => {
          if (my === seq.current) setResults([]);
        })
        .finally(() => {
          if (my === seq.current) setLoading(false);
        });
    }, 300);
    return () => clearTimeout(handle);
  }, [q, all, notebookId, channelId]);

  const hasQuery = q.trim().length > 0;

  return (
    <aside className="flex h-full w-full flex-col border-l bg-background sm:w-80" data-testid="search-panel" aria-label={t("team.search.title")}>
      <div className="flex items-center gap-2 border-b p-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("team.search.placeholder")}
            aria-label={t("team.search.placeholder")}
            className="h-9 pl-8"
            data-testid="search-input"
          />
        </div>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label={t("team.search.close")}>
          <X />
        </Button>
      </div>
      <div className="flex gap-1 border-b px-3 py-2 text-xs">
        {[
          { v: false, label: channelLabel },
          { v: true, label: t("team.search.allChannels") },
        ].map((opt) => (
          <button
            key={String(opt.v)}
            type="button"
            onClick={() => setAll(opt.v)}
            aria-pressed={all === opt.v}
            className={cn("max-w-40 truncate rounded-full border px-2.5 py-1", all === opt.v ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="search-results">
        {!hasQuery ? (
          <p className="p-4 text-center text-sm text-muted-foreground">{t("team.search.hint")}</p>
        ) : loading && !results ? (
          <p className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
          </p>
        ) : !results || results.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">{loading ? t("common.loading") : t("team.search.empty")}</p>
        ) : (
          <ul>
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onPick(r)} className="flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left hover:bg-accent" data-testid="search-result">
                  <UserAvatar name={r.sender.name} image={r.sender.image} className="size-7" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">{r.sender.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelative(r.createdAt, locale)}</span>
                    </span>
                    {all && (
                      <span className="block truncate text-[11px] text-primary">
                        {r.channelType === "dm" ? t("team.channel.dm") : r.channelType === "general" ? t("team.channel.general") : `#${r.channelName ?? ""}`}
                      </span>
                    )}
                    <span className="line-clamp-2 break-words text-sm text-muted-foreground">
                      <Highlight text={toPlainPreview(r.content, 400)} query={q} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
