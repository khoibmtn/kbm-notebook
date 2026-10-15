import "server-only";

/**
 * Lỗi khi xử lý nguồn. `permanent = true` (mặc định): thử lại cũng không khỏi (tệp hỏng, không có lớp văn bản,
 * loại chưa hỗ trợ…) → đánh dấu `failed` ngay, không retry job. `permanent = false`: lỗi tạm (mạng, AI) → để job retry.
 */
export class IngestError extends Error {
  readonly permanent: boolean;
  constructor(message: string, opts: { permanent?: boolean; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "IngestError";
    this.permanent = opts.permanent ?? true;
  }
}
