import "server-only";
import { EMBEDDING_DIM, type AiProvider } from "@/server/ai/provider";

export const EMBED_BATCH_SIZE = 32;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type EmbedOptions = {
  batchSize?: number;
  /** Khoảng chờ ban đầu giữa các lần thử (nhân đôi mỗi lần). Test đặt 0. */
  retryDelayMs?: number;
  /** Gọi sau mỗi batch với (số chunk đã xong, tổng). */
  onProgress?: (done: number, total: number) => void | Promise<void>;
};

/** Lỗi không nên thử lại (cấu hình sai / khoá sai): để job báo lỗi ngay. */
function isFatal(err: unknown): boolean {
  const e = err as { name?: string; status?: number | null } | null;
  if (e?.name === "AiNotConfiguredError") return true;
  if (e?.name === "AiProviderError" && typeof e.status === "number" && e.status >= 400 && e.status < 500 && e.status !== 429) return true;
  return false;
}

/**
 * Embedding hàng loạt cho tài liệu (taskType RETRIEVAL_DOCUMENT, 768 chiều), theo batch 32, thử lại tối đa 3 lần.
 * Trả về mảng vector cùng thứ tự với `texts`.
 */
export async function embedTexts(provider: AiProvider, texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
  const batchSize = opts.batchSize ?? EMBED_BATCH_SIZE;
  const delay = opts.retryDelayMs ?? 1000;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    let vectors: number[][] | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        vectors = await provider.embed(batch, { taskType: "RETRIEVAL_DOCUMENT", dim: EMBEDDING_DIM });
        if (vectors.length !== batch.length) throw new Error(`Embedding trả về ${vectors.length}/${batch.length} vector`);
        break;
      } catch (err) {
        if (attempt === MAX_ATTEMPTS || isFatal(err)) throw err;
        await sleep(delay * 2 ** (attempt - 1));
      }
    }
    out.push(...vectors!);
    await opts.onProgress?.(Math.min(i + batch.length, texts.length), texts.length);
  }
  return out;
}
