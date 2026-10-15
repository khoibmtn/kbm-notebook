"use client";

import { ImageIcon, Loader2, Minus, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n-client";
import { addColumn, removeColumn, setAt, toggleCitation } from "@/server/artifacts/slides/ops";
import { describeEvidenceLocator } from "@/server/artifacts/slides/sources";
import type { Slide, SlideDeckContent, SlideLayout } from "@/server/artifacts/slides/types";
import { ChartEditor, TableEditor } from "./data-editors";
import { LayoutPicker } from "./slide-rail";

export type ImageResult = { fileId?: string; dataUrl?: string } | void;

export type SlidePanelProps = {
  slide: Slide;
  index: number;
  content: SlideDeckContent;
  readOnly: boolean;
  onSlideChange: (s: Slide) => void;
  onLayoutChange: (layout: SlideLayout) => void;
  onAiEdit?: (slideId: string, instruction: string) => Promise<void>;
  onEvidenceClick?: (evidenceIndex: number) => void;
  onImageUpload?: (slideId: string, file: File) => Promise<ImageResult>;
  onImageGenerate?: (slideId: string, prompt: string) => Promise<ImageResult>;
};

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="space-y-2 border-b px-4 py-3 last:border-b-0" data-testid={testId}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Textarea có bản nháp cục bộ, xác nhận khi mất focus. */
function DraftTextarea({
  value,
  onCommit,
  disabled,
  ...rest
}: { value: string; onCommit: (v: string) => void; disabled?: boolean } & Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange" | "onBlur">) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  return <Textarea {...rest} disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onCommit(draft)} />;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function ImageSection({ slide, readOnly, onSlideChange, onImageUpload, onImageGenerate }: Pick<SlidePanelProps, "slide" | "readOnly" | "onSlideChange" | "onImageUpload" | "onImageGenerate">) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"gen" | "up" | null>(null);
  const image = slide.image;
  const apply = (r: ImageResult, prompt: string) => {
    if (r && (r.fileId || r.dataUrl)) onSlideChange({ ...slide, image: { ...(slide.image ?? { prompt }), prompt, fileId: r.fileId, dataUrl: r.dataUrl } });
  };
  return (
    <Section title={t("slides.panel.image")} testId="panel-image">
      <DraftTextarea
        rows={3}
        value={image?.prompt ?? ""}
        disabled={readOnly}
        placeholder={t("slides.image.promptPlaceholder")}
        aria-label={t("slides.image.prompt")}
        data-testid="image-prompt"
        className="text-xs"
        onCommit={(v) => onSlideChange(setAt(slide, "image.prompt", v))}
      />
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!onImageGenerate || !image?.prompt.trim() || busy !== null}
            title={onImageGenerate ? undefined : t("slides.image.noGenerator")}
            data-testid="image-generate"
            onClick={async () => {
              if (!onImageGenerate || !image) return;
              setBusy("gen");
              try {
                apply(await onImageGenerate(slide.id, image.prompt), image.prompt);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t("common.error"));
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "gen" ? <Loader2 className="animate-spin" /> : <Sparkles />} {t("slides.image.generate")}
          </Button>
          <Button type="button" size="xs" variant="outline" disabled={busy !== null} onClick={() => fileRef.current?.click()} data-testid="image-upload">
            {busy === "up" ? <Loader2 className="animate-spin" /> : <Upload />} {t("slides.image.upload")}
          </Button>
          {(image?.fileId || image?.dataUrl) && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => onSlideChange({ ...slide, image: { prompt: image.prompt, caption: image.caption } })}
            >
              <Trash2 /> {t("slides.image.remove")}
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            data-testid="image-file-input"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy("up");
              try {
                if (onImageUpload) apply(await onImageUpload(slide.id, file), image?.prompt ?? "");
                else apply({ dataUrl: await readAsDataUrl(file) }, image?.prompt ?? "");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : t("common.error"));
              } finally {
                setBusy(null);
              }
            }}
          />
        </div>
      )}
      {!image?.fileId && !image?.dataUrl && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImageIcon className="size-3.5" aria-hidden /> {t("slides.image.empty")}
        </p>
      )}
    </Section>
  );
}

function AiSection({ slide, onAiEdit }: { slide: Slide; onAiEdit: (id: string, instruction: string) => Promise<void> }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const instruction = text.trim();
    if (!instruction || busy) return;
    setBusy(true);
    try {
      await onAiEdit(slide.id, instruction);
      setText("");
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("slides.ai.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t("slides.panel.ai")} testId="panel-ai">
      <Textarea
        rows={3}
        value={text}
        disabled={busy}
        placeholder={t("slides.ai.placeholder")}
        aria-label={t("slides.panel.ai")}
        data-testid="ai-instruction"
        className="text-xs"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void run();
          }
        }}
      />
      <Button type="button" size="sm" className="w-full" disabled={busy || !text.trim()} onClick={run} data-testid="ai-run">
        {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? t("slides.ai.running") : t("slides.ai.run")}
      </Button>
    </Section>
  );
}

export function SlidePanel({ slide, index, content, readOnly, onSlideChange, onLayoutChange, onAiEdit, onEvidenceClick, onImageUpload, onImageGenerate }: SlidePanelProps) {
  const t = useT();
  const cited = (slide.citations ?? []).filter((n) => n >= 1 && n <= content.evidence.length);
  const uncited = content.evidence.map((_, i) => i + 1).filter((n) => !cited.includes(n));
  const hasImage = slide.layout === "image_text";

  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col overflow-y-auto border-t lg:w-[320px] lg:border-l lg:border-t-0" data-testid="slide-panel" aria-label={t("slides.panel.title", { n: index + 1 })}>
      {!readOnly && (
        <Section title={t("slides.panel.layout")} testId="panel-layout">
          <LayoutPicker value={slide.layout} onPick={onLayoutChange} />
        </Section>
      )}

      {!readOnly && slide.layout === "two_column" && (
        <Section title={t("slides.panel.columns")}>
          <div className="flex items-center gap-2">
            <Button type="button" size="xs" variant="outline" disabled={(slide.columns?.length ?? 0) >= 3} onClick={() => onSlideChange(addColumn(slide))}>
              <Plus /> {t("slides.columns.add")}
            </Button>
            <Button type="button" size="xs" variant="outline" disabled={(slide.columns?.length ?? 0) <= 1} onClick={() => onSlideChange(removeColumn(slide, (slide.columns?.length ?? 1) - 1))}>
              <Minus /> {t("slides.columns.remove")}
            </Button>
          </div>
        </Section>
      )}

      {!readOnly && slide.layout === "chart" && slide.chart && (
        <Section title={t("slides.panel.chart")} testId="panel-chart">
          <ChartEditor chart={slide.chart} onChange={(c) => onSlideChange({ ...slide, chart: c })} />
        </Section>
      )}

      {!readOnly && slide.layout === "table" && slide.table && (
        <Section title={t("slides.panel.table")} testId="panel-table">
          <TableEditor table={slide.table} onChange={(tb) => onSlideChange({ ...slide, table: tb })} />
        </Section>
      )}

      {hasImage && <ImageSection slide={slide} readOnly={readOnly} onSlideChange={onSlideChange} onImageUpload={onImageUpload} onImageGenerate={onImageGenerate} />}

      <Section title={t("slides.panel.notes")} testId="panel-notes">
        <DraftTextarea
          rows={5}
          value={slide.notes ?? ""}
          disabled={readOnly}
          placeholder={t("slides.notes.placeholder")}
          aria-label={t("slides.panel.notes")}
          data-testid="notes-input"
          className="text-xs leading-relaxed"
          onCommit={(v) => onSlideChange({ ...slide, notes: v.trim() ? v : undefined })}
        />
      </Section>

      <Section title={t("slides.panel.citations")} testId="panel-citations">
        {cited.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("slides.citations.empty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {cited.map((n) => {
              const ev = content.evidence[n - 1];
              const where = describeEvidenceLocator(ev.locator);
              return (
                <li key={n} className="flex items-start gap-1.5">
                  <button
                    type="button"
                    data-testid={`panel-citation-${n}`}
                    onClick={() => onEvidenceClick?.(n - 1)}
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-accent"
                  >
                    <span className="rounded bg-primary/10 px-1.5 font-medium text-primary">[{n}]</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{ev.sourceTitle}</span>
                      {where && <span className="block truncate text-muted-foreground">{where}</span>}
                    </span>
                  </button>
                  {!readOnly && (
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={t("slides.citations.remove")} onClick={() => onSlideChange(toggleCitation(slide, n, false))}>
                      <X />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!readOnly && uncited.length > 0 && (
          <Select value="" onValueChange={(v) => onSlideChange(toggleCitation(slide, Number(v), true))}>
            <SelectTrigger className="h-8 w-full text-xs" aria-label={t("slides.citations.add")}>
              <SelectValue placeholder={t("slides.citations.add")} />
            </SelectTrigger>
            <SelectContent>
              {uncited.map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs">
                  [{n}] {content.evidence[n - 1].sourceTitle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Section>

      {!readOnly && onAiEdit && <AiSection slide={slide} onAiEdit={onAiEdit} />}
    </aside>
  );
}
