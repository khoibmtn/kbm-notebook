import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getAiProviderForUser } from "@/server/ai";
import type { AiProvider } from "@/server/ai/provider";
import { db } from "@/server/db";
import { files, sourceChunks, sources, type Source } from "@/server/db/schema";
import { getStorage } from "@/server/storage/local";
import { detectFileType, estimateTokens, type SourceFileType } from "@/lib/sources";
import { setSourceStatus } from "../sources";
import { chunkDocument, buildDocument, type Chunk } from "./chunk";
import { embedTexts } from "./embed";
import { IngestError } from "./errors";
import { extractFile, extractPastedText, extractUrl, type Extracted } from "./extract";
import { summarizeSource } from "./summarize";

export type IngestDeps = {
  /** Mặc định: AI của người tạo nguồn (khoá người dùng → khoá server → mock). */
  getProvider?: (userId: string) => Promise<AiProvider>;
  /** Khoảng chờ retry embedding (test đặt 0). */
  retryDelayMs?: number;
};

const INSERT_BATCH = 100;

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of stream) parts.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(parts);
}

async function extractForSource(src: Source): Promise<Extracted & { finalUrl?: string }> {
  switch (src.kind) {
    case "file":
    case "drive": {
      // Nguồn Google Drive đã được tải về `files` lúc nhập → xử lý như tệp thường.
      if (!src.fileId) throw new IngestError("Nguồn không có tệp đính kèm");
      const [file] = await db.select().from(files).where(eq(files.id, src.fileId)).limit(1);
      if (!file) throw new IngestError("Tệp gốc không còn tồn tại");
      const metaType = src.metadata?.fileType;
      const type = (typeof metaType === "string" ? (metaType as SourceFileType) : null) ?? detectFileType(file.originalName, file.mime);
      if (!type) throw new IngestError("Định dạng tệp chưa được hỗ trợ");
      let buf: Buffer;
      try {
        buf = await readAll(await getStorage().getStream(file.storageKey));
      } catch (err) {
        throw new IngestError("Không đọc được tệp từ bộ nhớ lưu trữ", { cause: err });
      }
      return extractFile(buf, type);
    }
    case "url":
      if (!src.url) throw new IngestError("Nguồn không có URL");
      return extractUrl(src.url);
    case "text":
      return extractPastedText(src.rawText ?? "");
    case "youtube":
      throw new IngestError("Nguồn YouTube chưa hỗ trợ");
    default:
      throw new IngestError(`Loại nguồn "${src.kind}" chưa được hỗ trợ xử lý`);
  }
}

/**
 * Xử lý một nguồn: extract → chunk → embed → lưu → tóm tắt → `ready`.
 * Mọi lỗi được ném ra để handler phân loại (vĩnh viễn → failed; tạm thời → retry).
 */
export async function ingestSource(sourceId: string, deps: IngestDeps = {}): Promise<{ chunks: number } | null> {
  const [src] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.id, sourceId), isNull(sources.deletedAt)))
    .limit(1);
  if (!src) return null; // đã bị xoá

  await setSourceStatus(sourceId, { status: "processing", progress: 5, error: null });

  const extracted = await extractForSource(src);
  await setSourceStatus(sourceId, { status: "processing", progress: 25 });

  const doc = buildDocument(extracted.segments);
  const chunks: Chunk[] = chunkDocument(doc);
  if (chunks.length === 0) throw new IngestError("Không trích xuất được nội dung văn bản từ nguồn này");
  await setSourceStatus(sourceId, { status: "processing", progress: 35 });

  const provider = await (deps.getProvider ?? getAiProviderForUser)(src.createdBy);
  let lastReported = 35;
  const vectors = await embedTexts(
    provider,
    chunks.map((c) => c.text),
    {
      retryDelayMs: deps.retryDelayMs,
      onProgress: async (done, total) => {
        const p = 35 + Math.round((done / total) * 50);
        if (p - lastReported >= 5 || done === total) {
          lastReported = p;
          await setSourceStatus(sourceId, { status: "processing", progress: p });
        }
      },
    },
  );

  // Lưu chunk trong một transaction; nếu nguồn bị xoá trong lúc xử lý thì bỏ kết quả.
  const stored = await db.transaction(async (tx) => {
    const locked = await tx.execute(sql`SELECT id FROM sources WHERE id = ${sourceId} AND deleted_at IS NULL FOR UPDATE`);
    if (locked.rows.length === 0) return false;
    await tx.delete(sourceChunks).where(eq(sourceChunks.sourceId, sourceId));
    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      await tx.insert(sourceChunks).values(
        chunks.slice(i, i + INSERT_BATCH).map((c, k) => ({
          sourceId,
          notebookId: src.notebookId,
          idx: c.idx,
          text: c.text,
          tokenCount: c.tokenCount,
          page: c.page ?? c.slide ?? null,
          section: c.section ?? null,
          startChar: c.startChar,
          endChar: c.endChar,
          embedding: vectors[i + k],
        })),
      );
    }
    return true;
  });
  if (!stored) return null;
  await setSourceStatus(sourceId, { status: "processing", progress: 90 });

  const summary = await summarizeSource(provider, src.title, doc.text);
  const titleAuto = src.metadata?.titleAuto === true;
  await setSourceStatus(sourceId, {
    status: "ready",
    progress: 100,
    error: null,
    change: "updated",
    set: {
      rawText: doc.text,
      pageCount: extracted.pageCount,
      tokenCount: estimateTokens(doc.text),
      summary: summary.summary,
      keyTopics: summary.keyTopics,
      ...(titleAuto && extracted.title ? { title: extracted.title.slice(0, 200) } : {}),
    },
    meta: {
      spans: doc.spans,
      unit: extracted.unit,
      summaryBy: summary.by,
      chunkCount: chunks.length,
      ...(extracted.finalUrl ? { finalUrl: extracted.finalUrl } : {}),
    },
  });
  return { chunks: chunks.length };
}
