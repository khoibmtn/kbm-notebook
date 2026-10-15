"use client";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Plus, RotateCcw, Shuffle, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { newItemId, type Flashcard, type FlashcardsContent } from "@/lib/artifacts/content";
import { useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import { CitationList } from "./citation-chip";
import { SourcesFooter } from "./sources-footer";

type Props = {
  /** Dùng làm khoá lưu tiến độ "đã thuộc" trong localStorage. */
  artifactId: string;
  content: FlashcardsContent;
  onChange?: (c: FlashcardsContent) => void;
  readOnly?: boolean;
  notebookId?: string;
};

const storageKey = (artifactId: string) => `kbm:flashcards:known:${artifactId}`;
const EMPTY_SET: ReadonlySet<string> = new Set();
const knownCache = new Map<string, { raw: string | null; ids: ReadonlySet<string> }>();
const knownListeners = new Set<() => void>();

/** Tiến độ "đã thuộc" lưu trong localStorage, đồng bộ giữa các thẻ/tab bằng useSyncExternalStore (ổn định tham chiếu khi dữ liệu không đổi). */
function readKnown(artifactId: string): ReadonlySet<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(artifactId));
  } catch {
    return knownCache.get(artifactId)?.ids ?? EMPTY_SET; // localStorage không dùng được → chỉ giữ trong phiên
  }
  const cached = knownCache.get(artifactId);
  if (cached && cached.raw === raw) return cached.ids;
  let ids: ReadonlySet<string> = EMPTY_SET;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    /* dữ liệu hỏng → coi như rỗng */
  }
  knownCache.set(artifactId, { raw, ids });
  return ids;
}

function writeKnown(artifactId: string, ids: ReadonlySet<string>) {
  const raw = JSON.stringify([...ids]);
  try {
    localStorage.setItem(storageKey(artifactId), raw);
  } catch {
    /* ghi không được → giữ trong bộ nhớ */
  }
  knownCache.set(artifactId, { raw, ids });
  knownListeners.forEach((l) => l());
}

function subscribeKnown(cb: () => void) {
  knownListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    knownListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function useKnownCards(artifactId: string) {
  const known = useSyncExternalStore(
    subscribeKnown,
    () => readKnown(artifactId),
    () => EMPTY_SET,
  );
  const toggle = useCallback(
    (cardId: string) => {
      const next = new Set(readKnown(artifactId));
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      writeKnown(artifactId, next);
    },
    [artifactId],
  );
  const reset = useCallback(() => writeKnown(artifactId, new Set()), [artifactId]);
  return { known, toggle, reset };
}

function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function CardPlayer({ artifactId, content, notebookId }: Pick<Props, "artifactId" | "content" | "notebookId">) {
  const t = useT();
  const { known, toggle: toggleKnownId, reset: resetKnown } = useKnownCards(artifactId);
  const [order, setOrder] = useState<string[]>(() => content.cards.map((c) => c.id));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [onlyUnknown, setOnlyUnknown] = useState(false);

  const byId = useMemo(() => new Map(content.cards.map((c) => [c.id, c])), [content.cards]);
  const queue = useMemo(() => {
    const ids = order.filter((id) => byId.has(id));
    // thẻ mới thêm sau khi sửa → nối vào cuối
    for (const c of content.cards) if (!ids.includes(c.id)) ids.push(c.id);
    return onlyUnknown ? ids.filter((id) => !known.has(id)) : ids;
  }, [order, byId, content.cards, onlyUnknown, known]);

  const current = queue.length ? byId.get(queue[Math.min(pos, queue.length - 1)]) : undefined;
  const knownCount = content.cards.filter((c) => known.has(c.id)).length;

  const go = useCallback(
    (delta: number) => {
      if (queue.length === 0) return;
      setFlipped(false);
      setPos((p) => (p + delta + queue.length) % queue.length);
    },
    [queue.length],
  );

  const toggleKnown = (card: Flashcard) => toggleKnownId(card.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " " && el?.tagName !== "BUTTON") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (!current) {
    return (
      <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground" data-testid="flashcards-done">
        <p className="mb-3">{onlyUnknown ? t("studio.flashcards.allKnown") : t("studio.flashcards.empty")}</p>
        {onlyUnknown && (
          <Button variant="outline" onClick={() => { setOnlyUnknown(false); setPos(0); }}>
            {t("studio.flashcards.showAll")}
          </Button>
        )}
      </div>
    );
  }
  const isKnown = known.has(current.id);
  const idx = Math.min(pos, queue.length - 1);

  return (
    <div className="space-y-4" data-testid="flashcards-player">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span data-testid="flashcards-position">{t("studio.flashcards.position", { current: idx + 1, total: queue.length })}</span>
        <span data-testid="flashcards-known">{t("studio.flashcards.knownCount", { known: knownCount, total: content.cards.length })}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full bg-success transition-all" style={{ width: `${content.cards.length ? (knownCount / content.cards.length) * 100 : 0}%` }} />
      </div>

      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className={cn(
          "flex min-h-64 w-full flex-col items-center justify-center gap-3 rounded-2xl border bg-card p-8 text-center shadow-sm transition-colors hover:bg-accent/30",
          flipped && "border-primary/50 bg-primary/5",
        )}
        aria-label={flipped ? t("studio.flashcards.flipToFront") : t("studio.flashcards.flipToBack")}
        data-testid="flashcard"
        data-side={flipped ? "back" : "front"}
      >
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{flipped ? t("studio.flashcards.back") : t("studio.flashcards.front")}</span>
        <span className="whitespace-pre-wrap text-xl font-medium leading-relaxed" data-testid="flashcard-text">
          {flipped ? current.back : current.front}
        </span>
        {!flipped && current.hint && (
          <span className="text-sm text-muted-foreground">
            {t("studio.flashcards.hint")}: {current.hint}
          </span>
        )}
        {flipped && <CitationList citations={current.citations} evidence={content.evidence} notebookId={notebookId} />}
        {current.tags?.length ? <span className="text-xs text-muted-foreground">{current.tags.map((x) => `#${x}`).join(" ")}</span> : null}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => go(-1)} aria-label={t("studio.flashcards.prev")} data-testid="flashcard-prev">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" onClick={() => go(1)} aria-label={t("studio.flashcards.next")} data-testid="flashcard-next">
            <ChevronRight />
          </Button>
        </div>
        <Button variant={isKnown ? "default" : "outline"} onClick={() => toggleKnown(current)} aria-pressed={isKnown} data-testid="flashcard-known">
          <Check /> {isKnown ? t("studio.flashcards.known") : t("studio.flashcards.markKnown")}
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setOrder(shuffled(order)); setPos(0); setFlipped(false); }} data-testid="flashcards-shuffle">
            <Shuffle /> {t("studio.flashcards.shuffle")}
          </Button>
          <Button variant={onlyUnknown ? "secondary" : "outline"} onClick={() => { setOnlyUnknown((v) => !v); setPos(0); setFlipped(false); }} aria-pressed={onlyUnknown}>
            {t("studio.flashcards.onlyUnknown")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={resetKnown}
            aria-label={t("studio.flashcards.resetProgress")}
            title={t("studio.flashcards.resetProgress")}
          >
            <RotateCcw />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("studio.flashcards.keyboardHint")}</p>
      <SourcesFooter evidence={content.evidence} notebookId={notebookId} />
    </div>
  );
}

function CardEditor({ content, onChange }: { content: FlashcardsContent; onChange: (c: FlashcardsContent) => void }) {
  const t = useT();
  const set = (cards: Flashcard[]) => onChange({ ...content, cards });
  const patch = (id: string, p: Partial<Flashcard>) => set(content.cards.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...content.cards];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  return (
    <div className="space-y-3" data-testid="flashcards-editor">
      {content.cards.map((c, i) => (
        <div key={c.id} className="space-y-2 rounded-xl border bg-card p-4" data-testid="flashcard-editor-row">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{t("studio.flashcards.cardN", { n: i + 1 })}</span>
            <div className="ml-auto flex gap-1">
              <Button size="icon-sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("studio.edit.moveUp")}>
                <ArrowUp />
              </Button>
              <Button size="icon-sm" variant="ghost" disabled={i === content.cards.length - 1} onClick={() => move(i, 1)} aria-label={t("studio.edit.moveDown")}>
                <ArrowDown />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => set(content.cards.filter((x) => x.id !== c.id))} aria-label={t("studio.flashcards.removeCard")}>
                <Trash2 />
              </Button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Textarea value={c.front} onChange={(e) => patch(c.id, { front: e.target.value })} placeholder={t("studio.flashcards.front")} aria-label={t("studio.flashcards.front")} />
            <Textarea value={c.back} onChange={(e) => patch(c.id, { back: e.target.value })} placeholder={t("studio.flashcards.back")} aria-label={t("studio.flashcards.back")} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={c.hint ?? ""} onChange={(e) => patch(c.id, { hint: e.target.value || undefined })} placeholder={t("studio.flashcards.hint")} aria-label={t("studio.flashcards.hint")} />
            <Input
              value={(c.tags ?? []).join(", ")}
              onChange={(e) => {
                const tags = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
                patch(c.id, { tags: tags.length ? tags : undefined });
              }}
              placeholder={t("studio.flashcards.tags")}
              aria-label={t("studio.flashcards.tags")}
            />
          </div>
        </div>
      ))}
      <Button variant="outline" onClick={() => set([...content.cards, { id: newItemId("c"), front: "", back: "" }])} data-testid="flashcards-add">
        <Plus /> {t("studio.flashcards.addCard")}
      </Button>
    </div>
  );
}

/** Thẻ ghi nhớ: lật thẻ, trước/sau, xáo trộn, "đã thuộc" (localStorage) + chế độ chỉnh sửa. */
export function FlashcardsView({ artifactId, content, onChange, readOnly, notebookId }: Props) {
  const t = useT();
  const [mode, setMode] = useState<"study" | "edit">("study");
  const canEdit = !readOnly && Boolean(onChange);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {canEdit && (
        <div className="inline-flex rounded-lg border p-0.5" role="tablist" aria-label={t("studio.quiz.mode")}>
          {(["study", "edit"] as const).map((m) => (
            <Button key={m} role="tab" aria-selected={mode === m} size="sm" variant={mode === m ? "secondary" : "ghost"} onClick={() => setMode(m)} data-testid={`flashcards-mode-${m}`}>
              {t(m === "study" ? "studio.flashcards.modeStudy" : "studio.quiz.modeEdit")}
            </Button>
          ))}
        </div>
      )}
      {mode === "study" || !canEdit ? (
        <CardPlayer artifactId={artifactId} content={content} notebookId={notebookId} />
      ) : (
        <CardEditor content={content} onChange={onChange!} />
      )}
    </div>
  );
}
