import "server-only";
import { z } from "zod";
import type { AiProvider } from "@/server/ai/provider";

export type SourceSummary = { summary: string; keyTopics: string[]; by: "ai" | "extractive" };

const MAX_INPUT_CHARS = 24_000;

const outputSchema = z.object({
  summary: z.string().trim().min(1),
  key_topics: z.array(z.string().trim().min(1)).min(1),
});

const jsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Tóm tắt 3–5 câu bằng tiếng Việt" },
    key_topics: { type: "array", items: { type: "string" }, description: "5–8 chủ đề chính, mỗi chủ đề 1–4 từ" },
  },
  required: ["summary", "key_topics"],
} as const;

/** Lấy mẫu văn bản dài: đầu + giữa + cuối để tóm tắt bao quát. */
export function sampleForSummary(text: string, maxChars = MAX_INPUT_CHARS): string {
  if (text.length <= maxChars) return text;
  const part = Math.floor(maxChars / 3);
  const mid = Math.floor(text.length / 2 - part / 2);
  return [text.slice(0, part), text.slice(mid, mid + part), text.slice(text.length - part)].join("\n\n[…]\n\n");
}

const STOPWORDS = new Set(
  (
    "và của là có cho các một những được trong với này khi để không đã sẽ cũng như từ theo về tại hoặc nhưng nên thì mà bị đến " +
    "the and for that with this from are was were have has had not but you your they their will can its into than then also such " +
    "which what when where how who whom there these those been being over under between about after before"
  ).split(" "),
);

/** Tóm tắt "trích xuất" khi AI không trả kết quả hợp lệ: vài câu đầu + từ khoá tần suất cao. Dữ liệu lấy thật từ văn bản. */
export function extractiveSummary(text: string): { summary: string; keyTopics: string[] } {
  const flat = text.replace(/\s+/g, " ").trim();
  const sentences = flat.match(/[^.!?…]+[.!?…]+(?:\s|$)|[^.!?…]+$/g) ?? [flat];
  let summary = "";
  for (const s of sentences) {
    if ((summary + s).length > 600 && summary) break;
    summary += s.trim() + " ";
    if (summary.split(/[.!?…]/).length > 5) break;
  }
  summary = summary.trim().slice(0, 700);
  const freq = new Map<string, number>();
  for (const w of flat.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 4 || /^\d+$/.test(w) || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const keyTopics = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([w]) => w);
  return { summary, keyTopics };
}

/**
 * Tóm tắt (3–5 câu, tiếng Việt) + 5–8 chủ đề chính qua `generateText` với JSON schema.
 * Lỗi AI hoặc đầu ra không hợp lệ không làm hỏng việc xử lý nguồn → dùng tóm tắt trích xuất.
 */
export async function summarizeSource(provider: AiProvider, title: string, text: string): Promise<SourceSummary> {
  try {
    const res = await provider.generateText({
      system:
        "Bạn là trợ lý đọc tài liệu. Chỉ dựa vào nội dung được cung cấp, không bịa thêm. Trả lời bằng tiếng Việt.",
      messages: [
        {
          role: "user",
          content:
            `Tài liệu: "${title}"\n\nHãy viết bản tóm tắt gồm 3–5 câu và liệt kê 5–8 chủ đề chính (mỗi chủ đề ngắn gọn, 1–4 từ).\n\n` +
            `--- NỘI DUNG ---\n${sampleForSummary(text)}`,
        },
      ],
      temperature: 0.2,
      jsonSchema,
    });
    const parsed = outputSchema.safeParse(res.json ?? safeJson(res.text));
    if (parsed.success) {
      const keyTopics = [...new Set(parsed.data.key_topics.map((k) => k.trim()))].slice(0, 8);
      return { summary: parsed.data.summary.trim(), keyTopics, by: "ai" };
    }
  } catch (err) {
    console.warn("[ingest] tóm tắt bằng AI thất bại, dùng tóm tắt trích xuất:", err instanceof Error ? err.message : err);
  }
  return { ...extractiveSummary(text), by: "extractive" };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
