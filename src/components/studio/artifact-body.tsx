"use client";
import {
  isMarkdownType,
  type ArtifactTypeName,
  type DataTableContent,
  type FlashcardsContent,
  type MarkdownContent,
  type MindmapContent,
  type QuizContent,
} from "@/lib/artifacts/content";
import { DataTableView } from "./data-table-view";
import { clientEngines, EngineMissing, type InfographicContent, type SlideDeckContent } from "./engines";
import { FlashcardsView } from "./flashcards-view";
import { MarkdownDocView } from "./markdown-doc-view";
import { MindmapView } from "./mindmap-view";
import { QuizView } from "./quiz-view";

type Props = {
  artifactId: string;
  type: ArtifactTypeName;
  content: unknown;
  onChange?: (content: unknown) => void;
  readOnly?: boolean;
  /** Có → chip trích dẫn/Nguồn mở được Source viewer (không có ở trang chia sẻ công khai). */
  notebookId?: string;
};

/** Chọn trình xem/sửa theo loại artifact. slide_deck/infographic dùng engine ở `engines.tsx` (hoặc báo chưa có engine). */
export function ArtifactBody({ artifactId, type, content, onChange, readOnly, notebookId }: Props) {
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
      if (!Editor) return <EngineMissing kind="slide_deck" />;
      return <Editor content={content as SlideDeckContent} onChange={(c) => onChange?.(c)} readOnly={readOnly} />;
    }
    case "infographic": {
      const View = clientEngines.InfographicView;
      if (!View) return <EngineMissing kind="infographic" />;
      return <View content={content as InfographicContent} onChange={onChange ? (c) => onChange(c) : undefined} readOnly={readOnly} />;
    }
  }
}
