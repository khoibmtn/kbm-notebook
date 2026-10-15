"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { SlideEditor } from "@/components/studio/slides/slide-editor";
import { slideDeckSchema, type SlideDeckContent } from "@/server/artifacts/slides/types";

/** Bao quanh SlideEditor cho trang dev: giữ state cục bộ, xuất file qua route dev. */
export function DevSlides({ initial, banner }: { initial: unknown; banner: string }) {
  const [content, setContent] = useState<SlideDeckContent>(() => slideDeckSchema.parse(initial));
  const [evidenceClicked, setEvidenceClicked] = useState<number | null>(null);

  const onExport = useCallback(
    async (format: "pptx" | "pdf") => {
      const res = await fetch("/dev/slides/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, content }),
      });
      if (!res.ok) {
        toast.error(`Export ${format} lỗi (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `deck.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    [content],
  );

  return (
    <div className="flex h-[100dvh] flex-col gap-2 p-3">
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900" data-testid="dev-banner">
        {banner}
        {evidenceClicked !== null && <span data-testid="evidence-clicked"> · evidence #{evidenceClicked}</span>}
      </p>
      <div className="min-h-0 flex-1">
        <SlideEditor
          content={content}
          onChange={setContent}
          onExport={onExport}
          onEvidenceClick={setEvidenceClicked}
          onAiEdit={async (slideId, instruction) => {
            // Chỉ cho dev: không gọi mô hình; đánh dấu tiêu đề để kiểm tra luồng gọi.
            setContent((c) => ({
              ...c,
              slides: c.slides.map((s) => (s.id === slideId ? { ...s, title: `${s.title} [dev-ai: ${instruction.slice(0, 20)}]` } : s)),
            }));
          }}
        />
      </div>
    </div>
  );
}
