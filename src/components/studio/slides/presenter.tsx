"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n-client";
import { SLIDE_H, SLIDE_W } from "@/server/artifacts/slides/layouts";
import type { SlideDeckContent } from "@/server/artifacts/slides/types";
import { SlideView } from "./slide-view";

/** Xem trước dạng trình chiếu toàn màn hình: ←/→/Space/PageUp/PageDown để chuyển, Esc để thoát. */
export function Presenter({
  content,
  startIndex,
  resolveImageUrl,
  onClose,
}: {
  content: SlideDeckContent;
  startIndex: number;
  resolveImageUrl?: (fileId: string) => string;
  onClose: (lastIndex: number) => void;
}) {
  const t = useT();
  const total = content.slides.length;
  const [index, setIndex] = useState(Math.min(Math.max(0, startIndex), total - 1));
  const [scale, setScale] = useState(0.5);

  const go = useCallback((d: number) => setIndex((i) => Math.min(total - 1, Math.max(0, i + d))), [total]);

  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / SLIDE_W, window.innerHeight / SLIDE_H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(index);
      else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) go(1);
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) go(-1);
      else if (e.key === "Home") setIndex(0);
      else if (e.key === "End") setIndex(total - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, index, onClose, total]);

  const slide = content.slides[index];
  if (!slide) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black" role="dialog" aria-modal="true" aria-label={t("slides.present.title")} data-testid="presenter">
      <div onClick={() => go(1)} className="cursor-pointer">
        <SlideView slide={slide} theme={content.theme} index={index} total={total} scale={scale} resolveImageUrl={resolveImageUrl} />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-4 py-3 text-white opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" className="text-white hover:bg-white/20 hover:text-white" onClick={() => go(-1)} aria-label={t("slides.present.prev")} disabled={index === 0}>
            <ChevronLeft />
          </Button>
          <span className="min-w-14 text-center text-sm tabular-nums" data-testid="presenter-counter">
            {index + 1} / {total}
          </span>
          <Button type="button" variant="ghost" size="icon" className="text-white hover:bg-white/20 hover:text-white" onClick={() => go(1)} aria-label={t("slides.present.next")} disabled={index === total - 1}>
            <ChevronRight />
          </Button>
        </div>
        <Button type="button" variant="ghost" size="sm" className="text-white hover:bg-white/20 hover:text-white" onClick={() => onClose(index)} data-testid="presenter-exit">
          <X /> {t("slides.present.exit")}
        </Button>
      </div>
    </div>
  );
}
