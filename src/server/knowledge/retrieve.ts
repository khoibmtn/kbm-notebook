import "server-only";
import { localKnowledgeProvider } from "./providers/local";
import type { Evidence, KnowledgeProvider, RetrieveQuery } from "./providers/types";

export { rrfMerge, RRF_K } from "./rrf";
export { DEFAULT_TOP_K } from "./providers/local";

/**
 * Điểm vào duy nhất để lấy bằng chứng cho Chat/Studio (docs/02 §3.3).
 * Chạy song song các provider (mặc định: kho `local`), gộp, sắp theo score giảm dần và cắt `topK`.
 * P5 sẽ thêm provider web / notebooklm qua tham số `providers`.
 */
export async function retrieve(
  q: RetrieveQuery,
  providers: KnowledgeProvider[] = [localKnowledgeProvider],
): Promise<Evidence[]> {
  const results = await Promise.all(providers.map((p) => p.retrieve(q)));
  const all = results.flat();
  if (providers.length === 1) return all;
  return all.sort((a, b) => b.score - a.score).slice(0, q.topK ?? 12);
}
