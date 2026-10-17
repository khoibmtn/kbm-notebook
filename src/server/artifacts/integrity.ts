import "server-only";
import { ApiError } from "@/server/api/errors";
import { evidenceSchema } from "@/lib/artifacts/content";
import { sanitizeCitations } from "@/lib/citations";

/**
 * Toàn vẹn trích dẫn khi người dùng sửa nội dung artifact (M-5): `content.evidence` do server tạo từ nguồn thật, nên
 * client chỉ được GIỮ hoặc BỚT mục bằng chứng — không thêm/sửa (nếu không có thể dựng "trích dẫn nguyên văn" giả có
 * dáng vẻ căn cứ). Ngoài ra mọi số trích dẫn phải trỏ tới một mục có thật trong `evidence`.
 */

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

const evidenceKey = (e: unknown): string | null => {
  const parsed = evidenceSchema.safeParse(e);
  return parsed.success ? stableStringify(parsed.data) : null;
};

const evidenceOf = (content: unknown): unknown[] => {
  const ev = content && typeof content === "object" ? (content as { evidence?: unknown }).evidence : undefined;
  return Array.isArray(ev) ? ev : [];
};

/** Mọi mảng `citations` (số nguyên) ở bất kỳ đâu trong nội dung, trừ chính `evidence`. */
function collectCitationNumbers(node: unknown, out: number[] = [], skipKey = "evidence"): number[] {
  if (Array.isArray(node)) {
    for (const item of node) collectCitationNumbers(item, out, skipKey);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === skipKey) continue;
      if (k === "citations" && Array.isArray(v)) {
        for (const n of v) if (typeof n === "number") out.push(n);
      } else {
        collectCitationNumbers(v, out, skipKey);
      }
    }
  }
  return out;
}

/** Ném 400 nếu nội dung mới có bằng chứng lạ hoặc trích dẫn trỏ ngoài danh sách `evidence`. */
export function assertContentIntegrity(next: unknown, base: unknown): void {
  const baseKeys = new Set(evidenceOf(base).map(evidenceKey).filter((k): k is string => k !== null));
  const nextEvidence = evidenceOf(next);
  for (const e of nextEvidence) {
    const key = evidenceKey(e);
    if (key === null || !baseKeys.has(key)) {
      throw new ApiError(
        400,
        "evidence_tampered",
        "Không thể thêm hoặc sửa nguồn trích dẫn của artifact (chỉ được giữ nguyên hoặc bỏ bớt). Hãy tạo lại artifact nếu cần bằng chứng mới.",
      );
    }
  }
  const max = nextEvidence.length;
  const bad = collectCitationNumbers(next).filter((n) => !Number.isInteger(n) || n < 1 || n > max);
  const markdown = next && typeof next === "object" ? (next as { markdown?: unknown }).markdown : undefined;
  const badMarkdown = typeof markdown === "string" ? sanitizeCitations(markdown, max).removed : [];
  if (bad.length > 0 || badMarkdown.length > 0) {
    const first = [...new Set([...bad, ...badMarkdown])].slice(0, 3).join(", ");
    throw new ApiError(400, "invalid_citation", `Trích dẫn [${first}] không trỏ tới nguồn nào trong danh sách nguồn của artifact`);
  }
}
