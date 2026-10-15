import "server-only";
import { ApiError } from "@/server/api/errors";
import { EXPORT_FORMAT_INFO, isExportFormatAllowed, safeFileName, type ExportFormat } from "@/lib/artifacts/meta";
import type {
  ArtifactTypeName,
  DataTableContent,
  FlashcardsContent,
  MindmapContent,
  QuizContent,
} from "@/lib/artifacts/content";
import { t } from "@/lib/i18n";
import { getInfographicEngine, getSlideEngine, type InfographicContent, type SlideDeckContent } from "../registry";
import { dataTableToCsv, flashcardsToAnkiTsv, flashcardsToCsv, quizToCsv } from "./csv";
import { markdownToDocx } from "./docx";
import { withPage } from "./browser";
import { contentToMarkdown } from "./markdown";
import { renderMindmap } from "./mindmap-render";
import { markdownToPdf } from "./pdf";

export type ExportInput = {
  type: ArtifactTypeName;
  title: string;
  content: unknown;
  versionNo?: number | null;
  /** Lấy ảnh theo `fileId` cho PPTX (engine slide gọi khi cần). */
  resolveImage?: (fileId: string) => Promise<Buffer | null>;
};

export type ExportOutput = { buffer: Buffer; mime: string; fileName: string; format: ExportFormat };

function fileNameFor(title: string, format: ExportFormat): string {
  return `${safeFileName(title)}.${EXPORT_FORMAT_INFO[format].ext}`;
}

/**
 * Tạo byte của một bản xuất. Dùng chung cho xuất đồng bộ (route) và job `export_artifact`.
 * Định dạng không hợp lệ cho loại → 400; slide/infographic đi qua engine ở `registry.ts` (501 nếu chưa có).
 */
export async function buildExport(input: ExportInput, format: ExportFormat): Promise<ExportOutput> {
  const { type, title, content } = input;
  if (!isExportFormatAllowed(type, format)) {
    throw ApiError.badRequest(`Định dạng ${format.toUpperCase()} không áp dụng cho loại này`, "unsupported_format");
  }
  const info = EXPORT_FORMAT_INFO[format];
  const out = (buffer: Buffer): ExportOutput => ({ buffer, mime: info.mime, fileName: fileNameFor(title, format), format });

  if (format === "json") {
    const payload = { type, title, version: input.versionNo ?? null, exportedAt: new Date().toISOString(), content };
    return out(Buffer.from(JSON.stringify(payload, null, 2), "utf8"));
  }

  switch (format) {
    case "md":
      return out(Buffer.from(contentToMarkdown(type, title, content), "utf8"));
    case "docx":
      return out(await markdownToDocx(contentToMarkdown(type, title, content), { title }));
    case "pdf": {
      const { buffer } = await markdownToPdf(contentToMarkdown(type, title, content), title);
      return out(buffer);
    }
    case "csv":
      if (type === "data_table") return out(Buffer.from(dataTableToCsv(content as DataTableContent), "utf8"));
      if (type === "quiz") return out(Buffer.from(quizToCsv(content as QuizContent), "utf8"));
      if (type === "flashcards") return out(Buffer.from(flashcardsToCsv(content as FlashcardsContent), "utf8"));
      break;
    case "apkg_tsv":
      return out(Buffer.from(flashcardsToAnkiTsv(content as FlashcardsContent), "utf8"));
    case "pptx": {
      const engine = getSlideEngine();
      return out(await engine.exportPptx(content as SlideDeckContent, { resolveImage: input.resolveImage }));
    }
    case "svg": {
      if (type === "mindmap") {
        const r = await renderMindmap((content as MindmapContent).root, { svg: true });
        return out(Buffer.from(r.svg ?? "", "utf8"));
      }
      if (type === "infographic") {
        const svg = await getInfographicEngine().exportSvg(content as InfographicContent);
        return out(Buffer.from(svg, "utf8"));
      }
      break;
    }
    case "png": {
      if (type === "mindmap") {
        const r = await renderMindmap((content as MindmapContent).root, { png: true });
        if (!r.png) throw new Error("Không dựng được ảnh sơ đồ tư duy");
        return out(r.png);
      }
      if (type === "infographic") {
        const svg = await getInfographicEngine().exportSvg(content as InfographicContent);
        return out(await svgToPng(svg));
      }
      break;
    }
  }
  throw ApiError.badRequest(t("studio.export.unsupported"), "unsupported_format");
}

/** SVG → PNG bằng Chromium (chặn mạng; SVG được nhúng qua data URL để không chạy script). */
export async function svgToPng(svg: string): Promise<Buffer> {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  return withPage(
    async (page) => {
      await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff"><img id="i" src="${dataUrl}" style="display:block"></body></html>`, { waitUntil: "load" });
      const box = await page.evaluate(() => {
        const img = document.getElementById("i") as HTMLImageElement;
        return { w: img.naturalWidth || 1200, h: img.naturalHeight || 800 };
      });
      await page.setViewportSize({ width: Math.min(box.w, 6000), height: Math.min(box.h, 6000) });
      return Buffer.from(await page.locator("#i").screenshot({ type: "png" }));
    },
    { deviceScaleFactor: 2 },
  );
}
