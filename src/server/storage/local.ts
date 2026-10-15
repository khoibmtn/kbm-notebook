import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { files, type FileRow } from "@/server/db/schema";
import { env } from "@/server/env";
import type { PutMeta, StorageAdapter } from "./adapter";

const KEY_RE = /^\d{4}\/\d{2}\/[0-9a-f-]{36}$/;

export class LocalDiskStorage implements StorageAdapter {
  private readonly root: string;
  private readonly maxBytes: number;

  constructor(opts: { root?: string; maxBytes?: number } = {}) {
    const e = env();
    this.root = path.resolve(/* turbopackIgnore: true */ opts.root ?? e.STORAGE_DIR);
    this.maxBytes = opts.maxBytes ?? e.MAX_UPLOAD_MB * 1024 * 1024;
  }

  /** Chuyển key → đường dẫn tuyệt đối, chặn path traversal. */
  private resolveKey(key: string): string {
    if (!KEY_RE.test(key)) throw new Error("storage key không hợp lệ");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("storage key không hợp lệ");
    return full;
  }

  async put(data: Buffer | Readable, meta: PutMeta): Promise<FileRow> {
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
    const finalPath = this.resolveKey(key);
    await mkdir(path.dirname(finalPath), { recursive: true });
    const tmpPath = `${finalPath}.part`;

    const hash = createHash("sha256");
    let size = 0;
    const maxBytes = this.maxBytes;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) {
          cb(new ApiError(413, "payload_too_large", `Tệp vượt quá giới hạn ${Math.round(maxBytes / 1024 / 1024)}MB`));
          return;
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });

    try {
      const source = Buffer.isBuffer(data) ? Readable.from([data]) : data;
      await pipeline(source, counter, createWriteStream(tmpPath, { mode: 0o600 }));
      await rename(tmpPath, finalPath);
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }

    try {
      const [row] = await db
        .insert(files)
        .values({
          ownerId: meta.ownerId,
          storageKey: key,
          originalName: meta.name.slice(0, 255),
          mime: meta.mime || "application/octet-stream",
          sizeBytes: size,
          sha256: hash.digest("hex"),
          notebookId: meta.notebookId ?? null,
          origin: meta.origin ?? null,
        })
        .returning();
      return row;
    } catch (err) {
      await rm(finalPath, { force: true });
      throw err;
    }
  }

  async getStream(key: string): Promise<Readable> {
    const full = this.resolveKey(key);
    await stat(full); // ném ENOENT nếu không có
    return createReadStream(full);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }
}

const g = globalThis as unknown as { __kbmStorage?: StorageAdapter };

/** Singleton adapter (đổi sang S3 ở đây khi cần). */
export function getStorage(): StorageAdapter {
  return (g.__kbmStorage ??= new LocalDiskStorage());
}
