"use client";
import { sourceViewerHref } from "@/lib/sources";
import {
  isMarkdownType,
  type ArtifactEvidence,
  type ArtifactTypeName,
  type DataTableContent,
  type FlashcardsContent,
  type MarkdownContent,
  type MindmapContent,
  type QuizContent,
} from "@/lib/artifacts/content";
import { DataTableView } from "./data-table-view";
import { clientEngines, type InfographicContent, type SlideDeckContent } from "./engines";
import { FlashcardsView } from "./flashcards-view";
import { MarkdownDocView } from "./markdown-doc-view";
import { MindmapView } from "./mindmap-view";
import { QuizView } from "./quiz-view";

/** Móc riêng cho engine slide/infographic (do trang artifact cấp; không có ở trang chia sẻ công khai). */
export type EngineHandlers = {
  /** Sửa một slide bằng AI (đã lưu bản nháp trước khi gọi). */
  onSlideAiEdit?: (slideId: string, instruction: string) => Promise<void>;
  /** Xuất qua khung xuất của Studio. */
  onExport?: (format: "pptx" | "pdf") => void;
  /** Tải ảnh lên kho tệp, trả `fileId`. */
  onSlideImageUpload?: (slideId: string, file: File) => Promise<{ fileId: string }>;
  /** Token liên kết chia sẻ: cho khách đọc ảnh của artifact (`/api/files/[id]?share=`). */
  shareToken?: string;
};

type Props = {
  artifactId: string;
  type: ArtifactTypeName;
  content: unknown;
  onChange?: (content: unknown) => void;
  readOnly?: boolean;
  /** Có → chip trích dẫn/Nguồn mở được Source viewer (không có ở trang chia sẻ công khai). */
  notebookId?: string;
  handlers?: EngineHandlers;
};

function imageUrlResolver(shareToken?: string) {
  return (fileId: string) => `/api/files/${fileId}${shareToken ? `?share=${encodeURIComponent(shareToken)}` : ""}`;
}

/** Bấm chip [n] (chỉ số 0-based) → mở Source viewer ở đoạn bằng chứng (tab mới để không mất bản nháp đang sửa). */
function evidenceOpener(notebookId: string | undefined, evidence: ArtifactEvidence[]) {
  if (!notebookId) return undefined;
  return (index: number) => {
    const ev = evidence[index];
    const href = ev ? sourceViewerHref(notebookId, ev) : null;
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  };
}

/** Chọn trình xem/sửa theo loại artifact. slide_deck/infographic dùng engine ở `engines.tsx` (hoặc báo chưa có engine). */
export function ArtifactBody({ artifactId, type, content, onChange, readOnly, notebookId, handlers }: Props) {
  const common = { readOnly, notebookId };
  if (isMarkdownType(type)) {
    return <MarkdownDocView content={content as MarkdownContent} onChange={onChange as ((c: MarkdownContent) => void) | undefined} {...common} />;
  }
  switch (type) {
    case "quiz":
      return <QuizView content={content as QuizContent} onChange={onChange as ((c: QuizContent) => void) | undefined} {...common} />;
    case "flashcards":
      return <FlashcardsView artifactId={artifactId} content={content as FlashcardsContent} onChange={onChange as ((c: FlashcardsContent) => void) | undefined} {...common} />;
    case "mindmap":
      return <MindmapView content={content as MindmapContent} onChange={onChange as ((c: MindmapContent) => void) | undefined} {...common} />;
    case "data_table":
      return <DataTableView content={content as DataTableContent} onChange={onChange as ((c: DataTableContent) => void) | undefined} {...common} />;
    case "slide_deck": {
      const Editor = clientEngines.SlideEditor;
      const deck = content as SlideDeckContent;
      return (
        <div className="h-[calc(100dvh-9rem)] min-h-[34rem]" data-testid="slide-deck-body">
          <Editor
            content={deck}
            onChange={(c) => onChange?.(c)}
            readOnly={readOnly}
            onAiEdit={readOnly ? undefined : handlers?.onSlideAiEdit}
            onExport={handlers?.onExport}
            resolveImageUrl={imageUrlResolver(handlers?.shareToken)}
            onEvidenceClick={evidenceOpener(notebookId, deck.evidence)}
            onImageUpload={readOnly ? undefined : handlers?.onSlideImageUpload}
          />
        </div>
      );
    }
    case "infographic": {
      const View = clientEngines.InfographicView;
      const info = content as InfographicContent;
      return <View content={info} onChange={onChange ? (c) => onChange(c) : undefined} readOnly={readOnly} onEvidenceClick={evidenceOpener(notebookId, info.evidence)} />;
    }
  }
}
