"use client";
import { Construction } from "lucide-react";
import type { ComponentType } from "react";
import type { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import type { infographicEnvelopeSchema, slideDeckEnvelopeSchema } from "@/lib/artifacts/content";
import { useT } from "@/lib/i18n-client";

/**
 * ĐIỂM NỐI DUY NHẤT phía giao diện với engine slide/infographic (do nhóm khác viết).
 *
 * Khi mô-đun có mặt (`src/components/studio/slides/slide-editor.tsx`, `src/components/studio/infographic/infographic-view.tsx`),
 * thay khối "STUB" bên dưới bằng:
 *
 *   import { SlideEditor } from "./slides/slide-editor";
 *   import { InfographicView } from "./infographic/infographic-view";
 *   export const clientEngines: ClientEngines = { SlideEditor, InfographicView };
 *
 * (và đăng ký phía máy chủ trong `src/server/artifacts/registry.ts`). Chưa có engine → hiện thông báo rõ ràng, không dựng giả.
 */
export type SlideDeckContent = z.infer<typeof slideDeckEnvelopeSchema>;
export type InfographicContent = z.infer<typeof infographicEnvelopeSchema>;

export type SlideEditorProps = {
  content: SlideDeckContent;
  onChange: (c: SlideDeckContent) => void;
  readOnly?: boolean;
  onAiEdit?: (slideId: string, instruction: string) => Promise<void>;
};
export type InfographicViewProps = {
  content: InfographicContent;
  onChange?: (c: InfographicContent) => void;
  readOnly?: boolean;
};

export type ClientEngines = {
  SlideEditor: ComponentType<SlideEditorProps> | null;
  InfographicView: ComponentType<InfographicViewProps> | null;
};

/* ============================== STUB (chưa có engine) ============================== */
export const clientEngines: ClientEngines = { SlideEditor: null, InfographicView: null };
/* ================================================================================= */

/** Thông báo "chưa có engine" cho slide_deck / infographic. */
export function EngineMissing({ kind }: { kind: "slide_deck" | "infographic" }) {
  const t = useT();
  return (
    <EmptyState
      icon={Construction}
      title={t(kind === "slide_deck" ? "studio.engine.slides.title" : "studio.engine.infographic.title")}
      description={t("studio.engine.missing")}
      badge={t("studio.badge.noEngine")}
    />
  );
}
