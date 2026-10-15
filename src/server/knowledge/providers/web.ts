import "server-only";
import { createHash } from "node:crypto";
import { getAiProviderForUser } from "@/server/ai";
import type { AiProvider, WebSource } from "@/server/ai/provider";
import type { Evidence, KnowledgeProvider, RetrieveQuery } from "./types";

export const WEB_MAX_RESULTS = 6;
const SNIPPET_MAX_CHARS = 1200;

const WEB_SYSTEM = `Bạn là công cụ tra cứu web. Dùng Google Search để tìm thông tin cập nhật, đáng tin cậy cho câu hỏi.
Tóm tắt NGẮN GỌN, trung thực những gì các trang web nói (tối đa khoảng 200 từ), nêu rõ thông tin nào có trong trang nào. Không bịa; nếu không tìm thấy, nói rõ.`;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Chuyển nguồn web của Gemini grounding thành Evidence (`provider: 'web'`, `locator.url`). Điểm giảm dần theo thứ tự trả về. */
export function webSourcesToEvidence(sources: WebSource[], summary: string): Evidence[] {
  const seen = new Set<string>();
  const unique = sources.filter((s) => {
    if (!s.url || seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
  const top = unique.slice(0, WEB_MAX_RESULTS);
  const shared = summary.trim().slice(0, SNIPPET_MAX_CHARS);
  return top.map((s, i) => {
    const snippet = s.snippet?.trim();
    return {
      id: `web:${createHash("sha1").update(s.url).digest("hex").slice(0, 16)}`,
      provider: "web" as const,
      sourceId: null,
      sourceTitle: s.title?.trim() || hostOf(s.url),
      locator: { url: s.url },
      // Grounding chỉ trả URL/tiêu đề; phần tóm tắt của mô hình (dựa trên các trang này) làm nội dung chung.
      text: snippet ? snippet.slice(0, SNIPPET_MAX_CHARS) : shared || (s.title ?? s.url),
      score: 1 / (60 + i + 1),
    };
  });
}

/**
 * Kho tri thức web: Gemini `googleSearch` grounding (docs/02 §3.2). Chỉ được gọi khi notebook.allow_web = true
 * và người dùng bật "Web" cho câu hỏi. Provider mock trả về danh sách rỗng.
 */
export class WebKnowledgeProvider implements KnowledgeProvider {
  readonly kind = "web" as const;

  constructor(private readonly deps: { getProvider?: (userId: string) => Promise<AiProvider> } = {}) {}

  async retrieve(q: RetrieveQuery): Promise<Evidence[]> {
    const query = q.query.trim();
    if (!query) return [];
    const provider = await (this.deps.getProvider ?? getAiProviderForUser)(q.userId);
    const res = await provider.generateText({
      system: WEB_SYSTEM,
      messages: [{ role: "user", content: query }],
      temperature: 0.2,
      tools: { googleSearch: true },
    });
    if (!res.webSources?.length) return [];
    return webSourcesToEvidence(res.webSources, res.text);
  }
}

export const webKnowledgeProvider = new WebKnowledgeProvider();
