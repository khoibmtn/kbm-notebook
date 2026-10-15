"use client";

import { Check, Download, FileDown, Palette, Play, Presentation, Redo2, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale, useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import { SLIDE_H, SLIDE_W } from "@/server/artifacts/slides/layouts";
import {
  changeLayout,
  defaultLabels,
  deleteSlide,
  duplicateSlide,
  insertSlide,
  moveSlide,
  newSlide,
  updateSlide,
} from "@/server/artifacts/slides/ops";
import { FONTS, PALETTES } from "@/server/artifacts/slides/themes";
import { SLIDE_FONTS, SLIDE_PALETTES, type Slide, type SlideDeckContent, type SlideLayout, type SlideTheme } from "@/server/artifacts/slides/types";
import { Presenter } from "./presenter";
import { SlidePanel, type ImageResult } from "./slide-panel";
import { SlideRail } from "./slide-rail";
import { SlideView } from "./slide-view";

export type SlideEditorProps = {
  content: SlideDeckContent;
  onChange: (c: SlideDeckContent) => void;
  readOnly?: boolean;
  onAiEdit?: (slideId: string, instruction: string) => Promise<void>;
  onExport?: (format: "pptx" | "pdf") => void;
  resolveImageUrl?: (fileId: string) => string;
  /** Bấm chip [n]; tham số là chỉ số 0-based trong `content.evidence` (n - 1). */
  onEvidenceClick?: (evidenceIndex: number) => void;
  /** Tuỳ chọn: tải ảnh lên kho tệp. Không truyền → ảnh được nhúng dưới dạng `dataUrl`. */
  onImageUpload?: (slideId: string, file: File) => Promise<ImageResult>;
  /** Tuỳ chọn: tạo ảnh AI từ `image.prompt`. Không truyền → nút "Tạo ảnh" bị vô hiệu. */
  onImageGenerate?: (slideId: string, prompt: string) => Promise<ImageResult>;
};

const HISTORY_LIMIT = 100;

function useMediaQuery(query: string, serverValue: boolean): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

function isTextTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.getAttribute("role") === "combobox";
}

type History = { past: SlideDeckContent[]; future: SlideDeckContent[]; last: SlideDeckContent };

/** Lịch sử undo/redo đơn giản; thay đổi từ bên ngoài (vd. sửa bằng AI) cũng đưa vào lịch sử. */
function useDeckHistory(content: SlideDeckContent, onChange: (c: SlideDeckContent) => void) {
  const [h, setH] = useState<History>({ past: [], future: [], last: content });

  // Nội dung đổi từ bên ngoài (không phải do editor phát ra): đưa bản trước vào lịch sử.
  if (content !== h.last) {
    const external = JSON.stringify(h.last) !== JSON.stringify(content);
    setH({
      past: external ? [...h.past, h.last].slice(-HISTORY_LIMIT) : h.past,
      future: external ? [] : h.future,
      last: content,
    });
  }

  const commit = (next: SlideDeckContent) => {
    if (next === h.last) return;
    setH({ past: [...h.past, h.last].slice(-HISTORY_LIMIT), future: [], last: next });
    onChange(next);
  };

  const undo = () => {
    const prev = h.past[h.past.length - 1];
    if (!prev) return;
    setH({ past: h.past.slice(0, -1), future: [...h.future, h.last], last: prev });
    onChange(prev);
  };

  const redo = () => {
    const next = h.future[h.future.length - 1];
    if (!next) return;
    setH({ past: [...h.past, h.last], future: h.future.slice(0, -1), last: next });
    onChange(next);
  };

  return { commit, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0, latest: h.last };
}

export function SlideEditor({
  content,
  onChange,
  readOnly = false,
  onAiEdit,
  onExport,
  resolveImageUrl,
  onEvidenceClick,
  onImageUpload,
  onImageGenerate,
}: SlideEditorProps) {
  const t = useT();
  const { locale } = useLocale();
  const labels = defaultLabels(locale);
  const { commit, undo, redo, canUndo, canRedo, latest } = useDeckHistory(content, onChange);
  const isLg = useMediaQuery("(min-width: 1024px)", true);

  const [selectedId, setSelectedId] = useState(content.slides[0]?.id ?? "");
  const [presenting, setPresenting] = useState(false);
  const [scale, setScale] = useState(0.6);
  const canvasRef = useRef<HTMLDivElement>(null);

  const slides = content.slides;
  const selectedIndex = Math.max(0, slides.findIndex((s) => s.id === selectedId));
  const slide: Slide | undefined = slides[selectedIndex];

  // Nếu slide đang chọn biến mất (undo/xoá/thay nội dung), `selectedIndex` tự rơi về slide đầu.
  // Canvas co giãn vừa khung (theo cả chiều rộng và chiều cao khả dụng).
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const fit = () => {
      const pad = 48;
      const w = el.clientWidth - pad;
      const h = isLg ? el.clientHeight - pad : Number.POSITIVE_INFINITY;
      setScale(Math.max(0.15, Math.min(w / SLIDE_W, h / SLIDE_H)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLg]);

  const updateCurrent = (s: Slide) => {
    if (readOnly) return;
    commit(updateSlide(latest, s.id, () => s));
  };

  const setTheme = (patch: Partial<SlideTheme>) => commit({ ...latest, theme: { ...latest.theme, ...patch } });

  const addSlide = (layout: SlideLayout) => {
    const s = newSlide(layout, labels);
    commit(insertSlide(latest, selectedIndex + 1, s));
    setSelectedId(s.id);
  };

  const onDuplicate = (id: string) => {
    const r = duplicateSlide(latest, id);
    if (!r) return;
    commit(r.content);
    setSelectedId(r.newId);
  };

  const onDelete = (id: string) => {
    const cur = latest;
    if (cur.slides.length <= 1) return;
    const idx = cur.slides.findIndex((s) => s.id === id);
    const next = cur.slides[idx + 1] ?? cur.slides[idx - 1];
    commit(deleteSlide(cur, id));
    if (id === selectedId && next) setSelectedId(next.id);
  };

  const navigate = (delta: number) => {
    const target = slides[Math.min(slides.length - 1, Math.max(0, selectedIndex + delta))];
    if (target) setSelectedId(target.id);
  };

  // ⌘Z / ⌘⇧Z / Ctrl+Y ở cấp tài liệu (kể cả khi vừa bấm ra vùng trống của canvas).
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  useEffect(() => {
    undoRef.current = undo;
    redoRef.current = redo;
  });
  useEffect(() => {
    const onDocKey = (e: globalThis.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return; // để trình duyệt tự undo trong ô thường
      if (el?.closest("[role=dialog]")) return;
      e.preventDefault();
      if (el?.isContentEditable) el.blur(); // xác nhận phần đang gõ trước khi undo
      if (key === "y" || e.shiftKey) redoRef.current();
      else undoRef.current();
    };
    document.addEventListener("keydown", onDocKey);
    return () => document.removeEventListener("keydown", onDocKey);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTextTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowDown" || e.key === "PageDown") {
      e.preventDefault();
      navigate(1);
    } else if (e.key === "ArrowUp" || e.key === "PageUp") {
      e.preventDefault();
      navigate(-1);
    } else if ((e.key === "Delete" || e.key === "Backspace") && !readOnly && (e.target as HTMLElement).closest("[data-testid='slide-thumb']")) {
      e.preventDefault();
      const id = (e.target as HTMLElement).closest<HTMLElement>("[data-slide-id]")?.dataset.slideId;
      if (id) onDelete(id);
    }
  };

  if (!slide) return null;

  return (
    <div
      className="flex min-h-[560px] flex-col overflow-hidden rounded-xl border bg-background lg:h-full"
      data-testid="slide-editor"
      onKeyDown={onKeyDown}
    >
      {/* Thanh công cụ */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" role="toolbar" aria-label={t("slides.toolbar.label")}>
        <div className="mr-1 flex items-center gap-1.5 text-sm font-medium" data-testid="slide-counter" aria-live="polite">
          <Presentation className="size-4 text-muted-foreground" aria-hidden />
          {t("slides.toolbar.counter", { n: selectedIndex + 1, total: slides.length })}
        </div>

        {!readOnly && (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" data-testid="toolbar-palette">
                  <Palette />
                  <span
                    className="size-3.5 rounded-full border"
                    style={{ background: PALETTES[content.theme.palette].primary }}
                    aria-hidden
                  />
                  <span className="hidden sm:inline">{t("slides.toolbar.palette")}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64">
                <div className="grid grid-cols-3 gap-2">
                  {SLIDE_PALETTES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      data-testid={`palette-${p}`}
                      aria-pressed={content.theme.palette === p}
                      onClick={() => setTheme({ palette: p })}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-md border p-2 text-xs hover:bg-accent",
                        content.theme.palette === p && "border-primary bg-primary/5",
                      )}
                    >
                      <span className="relative flex size-7 items-center justify-center rounded-full" style={{ background: PALETTES[p].primary }}>
                        {content.theme.palette === p && <Check className="size-4 text-white" aria-hidden />}
                      </span>
                      {t(`slides.palette.${p}` as const)}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Select value={content.theme.font} onValueChange={(v) => setTheme({ font: v as SlideTheme["font"] })}>
              <SelectTrigger size="sm" className="w-[120px]" aria-label={t("slides.toolbar.font")} data-testid="toolbar-font">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SLIDE_FONTS.map((f) => (
                  <SelectItem key={f} value={f} style={{ fontFamily: FONTS[f].css }}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
            <Button type="button" variant="ghost" size="icon-sm" onClick={undo} disabled={!canUndo} title={`${t("slides.toolbar.undo")} (⌘Z)`} aria-label={t("slides.toolbar.undo")} data-testid="toolbar-undo">
              <Undo2 />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={redo} disabled={!canRedo} title={`${t("slides.toolbar.redo")} (⌘⇧Z)`} aria-label={t("slides.toolbar.redo")} data-testid="toolbar-redo">
              <Redo2 />
            </Button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPresenting(true)} data-testid="toolbar-present">
            <Play /> <span className="hidden sm:inline">{t("slides.toolbar.present")}</span>
          </Button>
          {onExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" data-testid="toolbar-export">
                  <Download /> <span className="hidden sm:inline">{t("slides.toolbar.export")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onExport("pptx")} data-testid="export-pptx">
                  <FileDown /> {t("slides.export.pptx")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onExport("pdf")} data-testid="export-pdf">
                  <FileDown /> {t("slides.export.pdf")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <SlideRail
          slides={slides}
          theme={content.theme}
          selectedId={slide.id}
          readOnly={readOnly}
          horizontal={!isLg}
          resolveImageUrl={resolveImageUrl}
          onSelect={setSelectedId}
          onReorder={(from, to) => commit(moveSlide(latest, from, to))}
          onAdd={addSlide}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />

        <div ref={canvasRef} className="flex min-h-[240px] min-w-0 flex-1 items-center justify-center overflow-auto bg-muted/40 p-6" data-testid="slide-canvas">
          <div className="shadow-lg ring-1 ring-border">
            <SlideView
              slide={slide}
              theme={content.theme}
              index={selectedIndex}
              total={slides.length}
              scale={scale}
              resolveImageUrl={resolveImageUrl}
              editable={!readOnly}
              onSlideChange={updateCurrent}
              onEvidenceClick={onEvidenceClick}
            />
          </div>
        </div>

        <SlidePanel
          slide={slide}
          index={selectedIndex}
          content={content}
          readOnly={readOnly}
          onSlideChange={updateCurrent}
          onLayoutChange={(l) => updateCurrent(changeLayout(slide, l, labels))}
          onAiEdit={onAiEdit}
          onEvidenceClick={onEvidenceClick}
          onImageUpload={onImageUpload}
          onImageGenerate={onImageGenerate}
        />
      </div>

      {presenting && (
        <Presenter
          content={content}
          startIndex={selectedIndex}
          resolveImageUrl={resolveImageUrl}
          onClose={(last) => {
            setPresenting(false);
            const target = slides[last];
            if (target) setSelectedId(target.id);
          }}
        />
      )}
    </div>
  );
}
