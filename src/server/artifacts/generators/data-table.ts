import "server-only";
import { CitationRemapper } from "@/lib/artifacts/citations";
import { dataTableContentSchema, type DataTableContent } from "@/lib/artifacts/content";
import { CITATION_RULES } from "../prompt";
import { dataTableOutputSchema } from "../schemas";
import { ArtifactGenerationError, generateJson, withContextBlock, type GeneratedArtifact, type GeneratorInput } from "./common";

const FORMAT_RULES = `Định dạng đầu ra: JSON {"title", "columns": [{"key","label"}], "rows": [{"cells": [...], "citations": [...]}]}.
- "cells" có đúng bấy nhiêu phần tử theo thứ tự "columns"; để chuỗi rỗng nếu nguồn không có giá trị (không bịa).
- "key" không dấu, chữ thường, không trùng nhau.`;

function slugKey(label: string, used: Set<string>, idx: number): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || `cot_${idx + 1}`;
  let key = base;
  for (let i = 2; used.has(key); i++) key = `${base}_${i}`;
  used.add(key);
  return key;
}

export async function generateDataTable(input: GeneratorInput): Promise<GeneratedArtifact> {
  const out = await generateJson(input, {
    type: "data_table",
    schema: dataTableOutputSchema,
    system: `${CITATION_RULES}\n${FORMAT_RULES}`,
    user: withContextBlock(input.instructions, input.contextText),
  });
  // Khoá cột do model đặt có thể trùng/không an toàn → sinh lại khoá duy nhất từ nhãn.
  const used = new Set<string>();
  const columns = out.columns.map((c, i) => ({ key: slugKey(c.key || c.label, used, i), label: c.label.trim() || c.key }));
  const remap = new CitationRemapper(input.evidence);
  const rows = out.rows
    .filter((r) => r.cells.some((c) => c.trim()))
    .map((r) => ({
      cells: Object.fromEntries(columns.map((col, i) => [col.key, remap.markdown((r.cells[i] ?? "").trim())])),
      citations: remap.list(r.citations),
    }));
  if (rows.length === 0) throw new ArtifactGenerationError("Model không trích xuất được dòng dữ liệu nào");
  const content: DataTableContent = dataTableContentSchema.parse({ columns, rows, evidence: remap.used });
  return { content, title: out.title.trim() || undefined };
}
