import "server-only";
import type { Readable } from "node:stream";
import type { FileRow } from "@/server/db/schema";

export type PutMeta = {
  /** Người sở hữu tệp (files.owner_id). */
  ownerId: string;
  mime: string;
  /** Tên gốc người dùng thấy (không dùng làm đường dẫn lưu). */
  name: string;
  /** Sổ tay chịu dung lượng của tệp (quota `MAX_NOTEBOOK_STORAGE_MB`). */
  notebookId?: string | null;
  /** Nguồn gốc tệp: `chat_upload` | `source_upload` | `artifact_image` | `export` | `drive`. */
  origin?: string;
};

/** Contract lưu trữ tệp (docs/02). Triển khai: LocalDiskStorage; S3 sau. */
export interface StorageAdapter {
  /** Lưu byte và tạo dòng `files`. Ném ApiError(413) nếu vượt MAX_UPLOAD_MB. */
  put(data: Buffer | Readable, meta: PutMeta): Promise<FileRow>;
  /** Đọc theo storage_key. */
  getStream(key: string): Promise<Readable>;
  /** Xoá byte theo storage_key (không xoá dòng `files`; xem deleteStoredFile). */
  delete(key: string): Promise<void>;
}
