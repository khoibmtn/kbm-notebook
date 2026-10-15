import "server-only";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import type { AiProvider } from "@/server/ai/provider";
import { editSlideWithAi, generateSlideDeck } from "./slides/generate";
import { exportSlideDeckPptx } from "./slides/export-pptx";
import { renderSlideDeckHtml } from "./slides/render-html";
import { slideDeckSchema } from "./slides/types";
import { generateInfographic } from "./infographic/generate";
import { exportInfographicSvg, renderInfographicHtml } from "./infographic/export";
import { infographicSchema } from "./infographic/types";
import {
  infographicEnvelopeSchema,
  slideDeckEnvelopeSchema,
  type ArtifactEvidence,
  type ArtifactTypeName,
} from "@/lib/artifacts/content";

/**
 * ĐIỂM NỐI DUY NHẤT với engine slide/infographic (docs/06-slide-engine.md).
 *
 * Framework chỉ gọi engine qua `getSlideEngine()` / `getInfographicEngine()` ở file này. Khối "WIRING" cuối file
 * đăng ký engine thật (`slides/*`, `infographic/*`); test có thể `registerEngines({ slide_deck: null })` để mô phỏng
 * môi trường chưa có engine (khi đó tạo/xuất trả HTTP 501 `not_implemented`, không bao giờ sinh nội dung giả) hoặc
 * tiêm engine giả để kiểm tra đường nối.
 */

export type SlideDeckContent = z.infer<typeof slideDeckEnvelopeSchema>;
export type InfographicContent = z.infer<typeof infographicEnvelopeSchema>;

export type EngineGenerateInput = {
  contextText: string;
  evidence: ArtifactEvidence[];
  instructions: string;
  options: Record<string, unknown>;
  provider: AiProvider;
  model?: string;
};

export type SlideDeckEngine = {
  generate(input: Omit<EngineGenerateInput, "options"> & {
    options: { slideCount?: number | "auto"; style?: "detailed" | "concise"; language?: string; audience?: string; includeImages?: boolean };
  }): Promise<SlideDeckContent>;
  exportPptx(content: SlideDeckContent, opts?: { resolveImage?: (fileId: string) => Promise<Buffer | null> }): Promise<Buffer>;
  /** Viết lại một slide bằng AI (trả toàn bộ deck với slide đó đã đổi). */
  editSlide?(input: {
    content: SlideDeckContent;
    slideId: string;
    instruction: string;
    contextText?: string;
    provider: AiProvider;
    model?: string;
  }): Promise<SlideDeckContent>;
  /** HTML in được (mỗi slide một trang 1280×720) để Chromium xuất PDF. */
  renderHtml?(content: SlideDeckContent, opts?: { resolveImageUrl?: (fileId: string) => string }): string;
};

export type InfographicEngine = {
  generate(input: EngineGenerateInput): Promise<InfographicContent>;
  exportSvg(content: InfographicContent): string | Promise<string>;
  /** HTML một trang đúng kích thước canvas (Chromium in PDF). */
  renderHtml?(content: InfographicContent): string;
};

export type Engines = {
  slide_deck: SlideDeckEngine | null;
  infographic: InfographicEngine | null;
};

const engineState: Engines = { slide_deck: null, infographic: null };

/** Đăng ký engine (gọi một lần ở khối wiring dưới; test dùng để tiêm engine giả kiểm tra đường nối). */
export function registerEngines(partial: Partial<Engines>): void {
  if ("slide_deck" in partial) engineState.slide_deck = partial.slide_deck ?? null;
  if ("infographic" in partial) engineState.infographic = partial.infographic ?? null;
}

export function notImplemented(what: string): ApiError {
  return new ApiError(501, "not_implemented", `${what} chưa có engine tạo/xuất (mô-đun slide/infographic chưa được tích hợp).`);
}

export function getSlideEngine(): SlideDeckEngine {
  if (!engineState.slide_deck) throw notImplemented("Bài thuyết trình");
  return engineState.slide_deck;
}

export function getInfographicEngine(): InfographicEngine {
  if (!engineState.infographic) throw notImplemented("Infographic");
  return engineState.infographic;
}

/** Loại này có engine tạo nội dung không? (loại nội bộ luôn có) */
export function isEngineAvailable(type: ArtifactTypeName): boolean {
  if (type === "slide_deck") return engineState.slide_deck !== null;
  if (type === "infographic") return engineState.infographic !== null;
  return true;
}

/** Ném 501 nếu loại phụ thuộc engine chưa được tích hợp. */
export function assertEngineAvailable(type: ArtifactTypeName): void {
  if (type === "slide_deck") getSlideEngine();
  if (type === "infographic") getInfographicEngine();
}

export function engineAvailability(): Record<ArtifactTypeName, boolean> {
  const out = {} as Record<ArtifactTypeName, boolean>;
  for (const t of ["note", "report", "study_guide", "faq", "timeline", "mindmap", "slide_deck", "infographic", "quiz", "flashcards", "data_table"] as const) {
    out[t] = isEngineAvailable(t);
  }
  return out;
}

/* ================================== WIRING ================================== */

function parseSlideDeck(content: SlideDeckContent): z.infer<typeof slideDeckSchema> {
  const r = slideDeckSchema.safeParse(content);
  if (!r.success) {
    throw ApiError.badRequest(`Nội dung bài thuyết trình không hợp lệ: ${r.error.issues[0]?.path.join(".") ?? ""} ${r.error.issues[0]?.message ?? ""}`.trim(), "invalid_content");
  }
  return r.data;
}

function parseInfographic(content: InfographicContent): z.infer<typeof infographicSchema> {
  const r = infographicSchema.safeParse(content);
  if (!r.success) {
    throw ApiError.badRequest(`Nội dung infographic không hợp lệ: ${r.error.issues[0]?.path.join(".") ?? ""} ${r.error.issues[0]?.message ?? ""}`.trim(), "invalid_content");
  }
  return r.data;
}

/** Đăng ký engine thật (chạy một lần khi nạp module; test gọi lại để khôi phục sau khi đã gỡ/tiêm engine giả). */
export function registerDefaultEngines(): void {
  registerEngines(defaultEngines());
}

function defaultEngines(): Engines {
  return {
    slide_deck: {
      generate: (input) => generateSlideDeck(input) as Promise<SlideDeckContent>,
      exportPptx: (content, opts) => exportSlideDeckPptx(parseSlideDeck(content), { resolveImage: opts?.resolveImage }),
      editSlide: async (input) => (await editSlideWithAi({ ...input, content: parseSlideDeck(input.content) })) as SlideDeckContent,
      renderHtml: (content, opts) => renderSlideDeckHtml(parseSlideDeck(content), { resolveImageUrl: opts?.resolveImageUrl }),
    },
    infographic: {
      generate: (input) => {
        const o = input.options as { orientation?: "portrait" | "landscape"; detailLevel?: "low" | "medium" | "high"; language?: string };
        return generateInfographic({
          ...input,
          options: {
            orientation: o.orientation,
            detail: o.detailLevel === "high" ? "detailed" : o.detailLevel ? "standard" : undefined,
            language: o.language,
          },
        }) as Promise<InfographicContent>;
      },
      exportSvg: (content) => exportInfographicSvg(parseInfographic(content)),
      renderHtml: (content) => renderInfographicHtml(parseInfographic(content)),
    },
  };
}

registerDefaultEngines();
/* ============================================================================= */
