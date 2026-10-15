import "server-only";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import type { AiProvider } from "@/server/ai/provider";
import {
  infographicEnvelopeSchema,
  slideDeckEnvelopeSchema,
  type ArtifactEvidence,
  type ArtifactTypeName,
} from "@/lib/artifacts/content";

/**
 * ĐIỂM NỐI DUY NHẤT với engine slide/infographic (mô-đun do nhóm khác viết).
 *
 * Framework chỉ gọi engine qua `engines.slide_deck` / `engines.infographic` ở file này.
 * Khi mô-đun có mặt (`src/server/artifacts/slides/*`, `src/server/artifacts/infographic/*`), thay khối
 * "STUB" bên dưới bằng:
 *
 *   import { generateSlideDeck } from "./slides/generate";
 *   import { exportSlideDeckPptx } from "./slides/export-pptx";
 *   import { generateInfographic } from "./infographic/generate";
 *   import { exportInfographicSvg } from "./infographic/export";
 *   registerEngines({
 *     slide_deck: { generate: generateSlideDeck, exportPptx: exportSlideDeckPptx },
 *     infographic: { generate: generateInfographic, exportSvg: exportInfographicSvg },
 *   });
 *
 * và (phía giao diện) làm tương tự trong `src/components/studio/engines.tsx`.
 * Chưa có engine → type vẫn được đăng ký nhưng tạo/xuất trả HTTP 501 `not_implemented`, không bao giờ sinh nội dung giả.
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
};

export type InfographicEngine = {
  generate(input: EngineGenerateInput): Promise<InfographicContent>;
  exportSvg(content: InfographicContent): string | Promise<string>;
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

/* ============================== STUB (chưa có engine) ============================== */
// Không đăng ký gì: `engineState` giữ null → mọi thao tác slide_deck/infographic trả 501 `not_implemented`.
/* ================================================================================= */
