import "server-only";
import { describeLocator } from "@/server/ai/context";
import type {
  ArtifactEvidence,
  ArtifactTypeName,
  DataTableContent,
  FlashcardsContent,
  MarkdownContent,
  MindmapContent,
  MindmapNode,
  QuizContent,
} from "@/lib/artifacts/content";
import { isMarkdownType } from "@/lib/artifacts/content";
import { t, type Locale } from "@/lib/i18n";

/** Dòng "[n] Tiêu đề nguồn (trang 3)" cho danh sách Nguồn. */
export function evidenceLine(ev: ArtifactEvidence, n: number): string {
  const where = describeLocator(ev.locator);
  return `[${n}] ${ev.sourceTitle}${where ? ` (${where})` : ""}`;
}

export function sourcesSection(evidence: ArtifactEvidence[], locale: Locale = "vi"): string {
  if (evidence.length === 0) return "";
  return `## ${t("studio.export.sources", undefined, locale)}\n\n${evidence.map((e, i) => `${i + 1}. ${evidenceLine(e, i + 1).replace(/^\[\d+\] /, "")}`).join("\n")}`;
}

function cites(c: number[] | undefined): string {
  return c?.length ? " " + c.map((n) => `[${n}]`).join("") : "";
}

const escapeCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

function mindmapOutline(node: MindmapNode, depth: number, lines: string[]): void {
  const label = `${node.label}${node.note ? ` — ${node.note}` : ""}${cites(node.citations)}`;
  if (depth === 0) lines.push(`# ${label}`, "");
  else lines.push(`${"  ".repeat(depth - 1)}- ${label}`);
  for (const c of node.children) mindmapOutline(c, depth + 1, lines);
}

/** Chuyển nội dung artifact sang Markdown (xuất `md`, nguồn của DOCX/PDF, và cột `content_md` để tìm kiếm). */
export function contentToMarkdown(type: ArtifactTypeName, title: string, content: unknown, locale: Locale = "vi"): string {
  const L = (k: Parameters<typeof t>[0]) => t(k, undefined, locale);
  if (isMarkdownType(type)) {
    const c = content as MarkdownContent;
    // Tiêu đề lấy từ tên artifact nếu nội dung chưa mở đầu bằng tiêu đề cấp 1.
    const head = /^\s*#\s/.test(c.markdown) ? "" : `# ${title}\n\n`;
    const src = sourcesSection(c.evidence, locale);
    return `${head}${c.markdown.trim()}${src ? `\n\n${src}` : ""}\n`;
  }
  switch (type) {
    case "quiz": {
      const c = content as QuizContent;
      const lines = [`# ${title}`, ""];
      c.questions.forEach((q, i) => {
        lines.push(`${i + 1}. **${q.stem}**${cites(q.citations)}`);
        if (q.type === "mcq") for (const o of q.options ?? []) lines.push(`   - ${o.key}. ${o.text}`);
        const ans = q.type === "tf" ? (q.answer === "true" ? L("studio.quiz.true") : L("studio.quiz.false")) : q.answer;
        lines.push("", `   *${L("studio.export.answer")}:* ${ans}`);
        if (q.explanation) lines.push(`   *${L("studio.export.explanation")}:* ${q.explanation}`);
        lines.push("");
      });
      const src = sourcesSection(c.evidence, locale);
      return lines.join("\n") + (src ? `\n${src}\n` : "");
    }
    case "flashcards": {
      const c = content as FlashcardsContent;
      const lines = [`# ${title}`, ""];
      c.cards.forEach((card, i) => {
        lines.push(`${i + 1}. **${card.front}**${cites(card.citations)}`, `   ${card.back}`);
        if (card.hint) lines.push(`   *${L("studio.flashcards.hint")}:* ${card.hint}`);
        lines.push("");
      });
      const src = sourcesSection(c.evidence, locale);
      return lines.join("\n") + (src ? `\n${src}\n` : "");
    }
    case "mindmap": {
      const c = content as MindmapContent;
      const lines: string[] = [];
      mindmapOutline(c.root, 0, lines);
      const src = sourcesSection(c.evidence, locale);
      return lines.join("\n") + (src ? `\n\n${src}\n` : "\n");
    }
    case "data_table": {
      const c = content as DataTableContent;
      const head = `| ${c.columns.map((col) => escapeCell(col.label)).join(" | ")} |`;
      const sep = `| ${c.columns.map(() => "---").join(" | ")} |`;
      const rows = c.rows.map((r) => `| ${c.columns.map((col) => escapeCell(r.cells[col.key] ?? "")).join(" | ")} |`);
      const src = sourcesSection(c.evidence, locale);
      return [`# ${title}`, "", head, sep, ...rows].join("\n") + (src ? `\n\n${src}\n` : "\n");
    }
    case "slide_deck": {
      const c = content as { slides: Array<Record<string, unknown>>; evidence: ArtifactEvidence[] };
      const lines = [`# ${title}`, ""];
      c.slides.forEach((s, i) => {
        lines.push(`## ${i + 1}. ${typeof s.title === "string" ? s.title : ""}`);
        if (typeof s.subtitle === "string") lines.push("", s.subtitle);
        if (Array.isArray(s.bullets)) for (const b of s.bullets) lines.push(`- ${String(b)}`);
        if (typeof s.notes === "string" && s.notes) lines.push("", `> ${s.notes}`);
        lines.push("");
      });
      const src = sourcesSection(c.evidence ?? [], locale);
      return lines.join("\n") + (src ? `\n${src}\n` : "");
    }
    case "infographic": {
      const c = content as { title?: string; subtitle?: string; evidence?: ArtifactEvidence[] };
      const src = sourcesSection(c.evidence ?? [], locale);
      return `# ${c.title || title}\n${c.subtitle ? `\n${c.subtitle}\n` : ""}${src ? `\n${src}\n` : ""}`;
    }
  }
}
