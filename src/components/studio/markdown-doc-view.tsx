"use client";
import { useCallback, useState } from "react";
import { MarkdownEditor } from "@/components/shared/markdown-editor";
import { MarkdownView } from "@/components/shared/markdown-view";
import { Button } from "@/components/ui/button";
import type { MarkdownContent } from "@/lib/artifacts/content";
import { useT } from "@/lib/i18n-client";
import { CitationChip } from "./citation-chip";
import { SourcesFooter } from "./sources-footer";

type Props = {
  content: MarkdownContent;
  onChange?: (c: MarkdownContent) => void;
  readOnly?: boolean;
  notebookId?: string;
};

/**
 * Báo cáo / hướng dẫn học tập / FAQ / dòng thời gian / ghi chú: xem (có chip trích dẫn) hoặc sửa bằng
 * `MarkdownEditor` (Tiptap), kèm chân trang "Nguồn" liệt kê bằng chứng với liên kết tới Source viewer.
 */
export function MarkdownDocView({ content, onChange, readOnly, notebookId }: Props) {
  const t = useT();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const canEdit = !readOnly && Boolean(onChange);
  const renderCitation = useCallback((n: number) => <CitationChip n={n} evidence={content.evidence} notebookId={notebookId} />, [content.evidence, notebookId]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {canEdit && (
        <div className="inline-flex rounded-lg border p-0.5" role="tablist" aria-label={t("studio.quiz.mode")}>
          {(["view", "edit"] as const).map((m) => (
            <Button key={m} role="tab" aria-selected={mode === m} size="sm" variant={mode === m ? "secondary" : "ghost"} onClick={() => setMode(m)} data-testid={`doc-mode-${m}`}>
              {t(m === "view" ? "studio.doc.modeView" : "studio.quiz.modeEdit")}
            </Button>
          ))}
        </div>
      )}
      {mode === "edit" && canEdit ? (
        <>
          <MarkdownEditor value={content.markdown} onChange={(markdown) => onChange!({ ...content, markdown })} ariaLabel={t("studio.doc.editorLabel")} />
          <p className="text-xs text-muted-foreground">{t("studio.doc.citationHint")}</p>
        </>
      ) : (
        <article className="rounded-xl border bg-card px-5 py-4">
          <MarkdownView markdown={content.markdown} renderCitation={renderCitation} />
        </article>
      )}
      <SourcesFooter evidence={content.evidence} notebookId={notebookId} />
    </div>
  );
}
