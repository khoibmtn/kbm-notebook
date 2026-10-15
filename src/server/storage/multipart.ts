import "server-only";
import Busboy from "busboy";
import { Readable, Transform } from "node:stream";
import { ApiError } from "@/server/api/errors";
import type { FileRow } from "@/server/db/schema";
import { env } from "@/server/env";
import { deleteStoredFile } from "./files";
import { getStorage } from "./local";
import { assertNotebookQuota, assertUploadBudget, chargeUploadBytes, chargeUploadFile, notebookQuotaError } from "./quota";

/**
 * Nhận multipart/form-data theo dòng (stream) thẳng xuống đĩa thay vì `req.formData()` (đệm cả body vào RAM).
 * - Kiểm `Content-Length` trước khi đọc (413 nếu quá lớn) + kiểm hạn mức tải lên / quota sổ tay (429/413).
 * - Mỗi tệp được ghi qua `StorageAdapter.put(stream)` (đếm byte, băm sha256, cắt ở `maxFileBytes`).
 * - Tổng số byte của body được đếm cả khi không có Content-Length (chunked).
 * Tệp bị từ chối (loại không hỗ trợ, quá lớn, trống, vượt hạn mức) được báo trong `rejected`; phần còn lại vẫn được lưu.
 */

export type ReceivedFile = { field: string; name: string; mime: string; row: FileRow };
export type RejectedFile = { name: string; status: number; code: string; message: string };
export type ReceiveResult = { files: ReceivedFile[]; rejected: RejectedFile[]; fields: Record<string, string> };

export type ReceiveOptions = {
  ownerId: string;
  /** Sổ tay chịu dung lượng (quota). */
  notebookId: string;
  origin: string;
  maxFiles: number;
  /** Mặc định `MAX_UPLOAD_MB`. */
  maxFileBytes?: number;
  /** Tên các trường chứa tệp (mặc định `files`, `file`). */
  fileFields?: string[];
  /** Kiểm tra theo tên + MIME trước khi ghi; trả lỗi để từ chối tệp mà không ghi gì. */
  accept?: (f: { name: string; mime: string }) => ApiError | null;
  /** Chuẩn hoá MIME lưu vào `files.mime` (mặc định giữ nguyên MIME khách gửi). Chỉ gọi sau `accept`. */
  normalizeMime?: (name: string, mime: string) => string;
  /** Thông báo riêng cho lỗi `too_many_files`. */
  tooManyMessage?: string;
};

const MB = 1024 * 1024;

/** Giới hạn tổng body của một request. */
export function requestBodyCap(maxFiles: number, maxFileBytes: number): number {
  return Math.min(env().MAX_UPLOAD_REQUEST_MB * MB, maxFiles * maxFileBytes) + MB;
}

function payloadTooLarge(capBytes: number): ApiError {
  return new ApiError(413, "payload_too_large", `Yêu cầu tải lên quá lớn (tối đa ${Math.ceil(capBytes / MB)}MB mỗi lần)`);
}

/** Từ chối sớm theo `Content-Length` (trước khi đọc body). */
export function assertContentLength(req: Request, capBytes: number): number | undefined {
  const raw = req.headers.get("content-length");
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  if (n > capBytes) throw payloadTooLarge(capBytes);
  return n;
}

/** Xoá các tệp đã ghi (khi cả request bị huỷ). */
export async function discardFiles(received: ReceivedFile[]): Promise<void> {
  for (const f of received) await deleteStoredFile(f.row.id).catch(() => {});
}

function byteCap(capBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > capBytes) cb(payloadTooLarge(capBytes));
      else cb(null, chunk);
    },
  });
}

export async function receiveMultipart(req: Request, opts: ReceiveOptions): Promise<ReceiveResult> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(contentType) || !req.body) {
    throw ApiError.badRequest("Yêu cầu phải là multipart/form-data", "invalid_form");
  }
  const maxFileBytes = opts.maxFileBytes ?? env().MAX_UPLOAD_MB * MB;
  const cap = requestBodyCap(opts.maxFiles, maxFileBytes);
  const declared = assertContentLength(req, cap);
  await assertUploadBudget(opts.ownerId, declared);
  await assertNotebookQuota(opts.notebookId, declared ?? 0);

  const fileFields = new Set(opts.fileFields ?? ["files", "file"]);
  const result: ReceiveResult = { files: [], rejected: [], fields: {} };
  let tooMany = false;
  let quotaFull = false;
  let budgetError: ApiError | null = null;

  const reject = (name: string, e: ApiError): void => {
    result.rejected.push({ name, status: e.status, code: e.code, message: e.message });
  };

  await new Promise<void>((resolve, reject_) => {
    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({
        headers: { "content-type": contentType },
        defParamCharset: "utf8",
        limits: { files: opts.maxFiles, fileSize: maxFileBytes, fields: 32, fieldSize: 64 * 1024, parts: opts.maxFiles + 40 },
      });
    } catch {
      reject_(ApiError.badRequest("Yêu cầu phải là multipart/form-data", "invalid_form"));
      return;
    }

    // Xử lý tuần tự từng tệp (busboy chỉ sang tệp kế khi tệp trước được đọc hết).
    let chain: Promise<void> = Promise.resolve();
    let failed: unknown = null;

    bb.on("field", (name, value) => {
      if (!(name in result.fields)) result.fields[name] = value;
    });
    bb.on("filesLimit", () => {
      tooMany = true;
    });
    bb.on("file", (field, stream, info) => {
      // Lỗi của luồng tệp (khách ngắt kết nối, vượt trần…) được báo qua `bb` / kết quả `put`; listener này chỉ để không "uncaught".
      stream.on("error", () => {});
      const name = info.filename || "tệp";
      const mime = info.mimeType || "application/octet-stream";
      const handle = async () => {
        const skip = (e: ApiError) => {
          reject(name, e);
          stream.resume();
        };
        if (!fileFields.has(field)) {
          stream.resume();
          return;
        }
        if (budgetError) return skip(budgetError);
        if (quotaFull) return skip(notebookQuotaError());
        const bad = opts.accept?.({ name, mime });
        if (bad) return skip(bad);
        try {
          await chargeUploadFile(opts.ownerId);
          await assertNotebookQuota(opts.notebookId, 0);
        } catch (e) {
          if (e instanceof ApiError) {
            if (e.status === 429) budgetError = e;
            else quotaFull = true;
            return skip(e);
          }
          throw e;
        }
        let row: FileRow;
        try {
          row = await getStorage().put(stream, {
            ownerId: opts.ownerId,
            mime: opts.normalizeMime ? opts.normalizeMime(name, mime) : mime,
            name,
            notebookId: opts.notebookId,
            origin: opts.origin,
          });
        } catch (e) {
          stream.resume();
          if (e instanceof ApiError) return reject(name, e);
          throw e;
        }
        const discard = async (err: ApiError) => {
          await deleteStoredFile(row.id).catch(() => {});
          reject(name, err);
        };
        if (stream.truncated) {
          return discard(new ApiError(413, "payload_too_large", `Tệp "${name}" vượt quá giới hạn ${Math.round(maxFileBytes / MB)}MB`));
        }
        if (row.sizeBytes === 0) return discard(ApiError.badRequest(`Tệp "${name}" trống`));
        try {
          await chargeUploadBytes(opts.ownerId, row.sizeBytes);
          await assertNotebookQuota(opts.notebookId, 0);
        } catch (e) {
          if (e instanceof ApiError) {
            if (e.status === 429) budgetError = e;
            else quotaFull = true;
            return discard(e);
          }
          await deleteStoredFile(row.id).catch(() => {});
          throw e;
        }
        result.files.push({ field, name, mime, row });
      };
      chain = chain.then(() =>
        handle().catch((e: unknown) => {
          failed ??= e;
          stream.resume(); // luôn đọc hết tệp để parser đi tiếp
        }),
      );
    });

    const finish = (err?: unknown) => {
      void chain.then(() => {
        if (err ?? failed) reject_(err ?? failed);
        else resolve();
      });
    };
    bb.once("close", () => finish());
    bb.on("error", (e) => finish(e));

    const body = Readable.fromWeb(req.body as import("node:stream/web").ReadableStream<Uint8Array>);
    const counter = byteCap(cap);
    body.on("error", (e) => bb.destroy(e instanceof Error ? e : new Error(String(e))));
    counter.on("error", (e) => {
      body.destroy();
      bb.destroy(e);
    });
    body.pipe(counter).pipe(bb);
  }).catch(async (e: unknown) => {
    await discardFiles(result.files);
    if (e instanceof ApiError) throw e;
    throw ApiError.badRequest("Không đọc được dữ liệu tải lên (yêu cầu bị gián đoạn hoặc sai định dạng)", "invalid_form");
  });

  if (tooMany) {
    await discardFiles(result.files);
    throw ApiError.badRequest(opts.tooManyMessage ?? `Tối đa ${opts.maxFiles} tệp mỗi lần tải lên`, "too_many_files");
  }
  return result;
}

/**
 * Với tệp đơn nhỏ cần đọc nội dung vào RAM (vd. ảnh artifact để dò byte): đọc body có giới hạn rồi parse bằng Web `Request`.
 * Từ chối theo Content-Length trước, và đếm byte khi đọc để chunked cũng bị chặn.
 */
export async function formDataWithLimit(req: Request, capBytes: number): Promise<FormData> {
  assertContentLength(req, capBytes);
  if (!req.body) throw ApiError.badRequest("Yêu cầu phải là multipart/form-data", "invalid_form");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > capBytes) {
      await reader.cancel().catch(() => {});
      throw payloadTooLarge(capBytes);
    }
    chunks.push(value);
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    throw ApiError.badRequest("Yêu cầu phải là multipart/form-data", "invalid_form");
  }
}
