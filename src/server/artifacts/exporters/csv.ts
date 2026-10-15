import "server-only";
import type { DataTableContent, FlashcardsContent, QuizContent } from "@/lib/artifacts/content";

const BOM = "﻿";

/** RFC 4180: bao dấu nháy khi có dấu phẩy, nháy kép hoặc xuống dòng; chống "CSV injection" cho ô bắt đầu bằng = + - @. */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: string[][]): string {
  return BOM + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function dataTableToCsv(c: DataTableContent): string {
  return toCsv([c.columns.map((col) => col.label), ...c.rows.map((r) => c.columns.map((col) => r.cells[col.key] ?? ""))]);
}

const QUIZ_HEADER = ["STT", "Loại", "Câu hỏi", "A", "B", "C", "D", "E", "Đáp án", "Giải thích", "Độ khó", "Trích dẫn"];

export function quizToCsv(c: QuizContent): string {
  const rows = c.questions.map((q, i) => {
    const opts = ["A", "B", "C", "D", "E"].map((k) => q.options?.find((o) => o.key === k)?.text ?? "");
    return [
      String(i + 1),
      q.type,
      q.stem,
      ...opts,
      q.answer,
      q.explanation,
      q.difficulty,
      (q.citations ?? []).map((n) => `[${n}]`).join(""),
    ];
  });
  return toCsv([QUIZ_HEADER, ...rows]);
}

export function flashcardsToCsv(c: FlashcardsContent): string {
  return toCsv([
    ["Mặt trước", "Mặt sau", "Gợi ý", "Thẻ phân loại"],
    ...c.cards.map((card) => [card.front, card.back, card.hint ?? "", (card.tags ?? []).join(" ")]),
  ]);
}

/** Trường Anki với `#html:true`: escape `& < >`, xuống dòng → `<br>`, bỏ tab (tab là dấu phân tách). */
function ankiField(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\t/g, " ")
    .replace(/\r?\n/g, "<br>");
}

/**
 * Anki: TSV `front\tback\ttags`. Dòng `#` đầu tệp là chỉ thị nhập của Anki (tab, cho phép HTML, cột thẻ phân loại = 3);
 * thẻ phân loại cách nhau bằng khoảng trắng (khoảng trắng trong tag đổi thành `_`).
 */
export function flashcardsToAnkiTsv(c: FlashcardsContent): string {
  const lines = ["#separator:tab", "#html:true", "#tags column:3"];
  for (const card of c.cards) {
    const tags = (card.tags ?? []).map((t) => t.trim().replace(/\s+/g, "_")).filter(Boolean).join(" ");
    const back = ankiField(card.back) + (card.hint ? `<br><i>${ankiField(card.hint)}</i>` : "");
    lines.push([ankiField(card.front), back, tags].join("\t"));
  }
  return lines.join("\n") + "\n";
}
