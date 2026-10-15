import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { files } from "@/server/db/schema";
import { canAccessFile } from "@/server/storage/files";
import { getStorage } from "@/server/storage/local";
import { parseDataUrl, probeImage } from "./slides/image-util";
import type { SlideDeckContent } from "./registry";

/** Ảnh trong slide: phần framework quan tâm (engine xem `slides/types.ts`). */
type SlideImage = { prompt?: string; fileId?: string; dataUrl?: string; caption?: string };
type SlideLike = { image?: SlideImage } & Record<string, unknown>;

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/**
 * Engine trả ảnh AI dạng `image.dataUrl`. Trước khi ghi `artifact_versions.content` ta lưu từng ảnh vào kho tệp
 * (chủ tệp = người tạo artifact), đổi sang `image.fileId` và XOÁ `dataUrl` để JSON không phình ra.
 * Ảnh không giải mã được thì giữ `prompt` và bỏ `dataUrl` (slide vẫn dùng được, người dùng tạo/tải ảnh lại).
 */
export async function persistSlideImages(content: SlideDeckContent, ownerId: string, title = "slide"): Promise<SlideDeckContent> {
  const slides = content.slides as SlideLike[];
  if (!slides.some((s) => s.image?.dataUrl)) return content;
  const storage = getStorage();
  const out: SlideLike[] = [];
  let n = 0;
  for (const slide of slides) {
    const img = slide.image;
    if (!img?.dataUrl) {
      out.push(slide);
      continue;
    }
    const { dataUrl, ...rest } = img;
    void dataUrl;
    const parsed = parseDataUrl(img.dataUrl);
    if (!parsed) {
      out.push({ ...slide, image: { prompt: "", ...rest } });
      continue;
    }
    n += 1;
    const stored = await storage.put(parsed.bytes, {
      ownerId,
      mime: parsed.mime,
      name: `${title.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40) || "slide"}-${n}.${EXT[parsed.mime] ?? "img"}`,
    });
    out.push({ ...slide, image: { prompt: "", ...rest, fileId: stored.id } });
  }
  return { ...content, slides: out as SlideDeckContent["slides"] };
}

/** Đọc byte của tệp (đã kiểm quyền người dùng) — dùng cho `resolveImage` của xuất PPTX và PDF. */
export async function readFileBytes(userId: string, fileId: string): Promise<Buffer | null> {
  if (!(await canAccessFile(userId, fileId))) return null;
  const [f] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!f) return null;
  const stream = await getStorage().getStream(f.storageKey);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

/** `fileId` → URL tải qua route có kiểm quyền. */
export function fileUrl(fileId: string): string {
  return `/api/files/${fileId}`;
}

/** Nhúng ảnh `fileId` thành `dataUrl` (cho HTML in PDF: Chromium bị chặn mạng nên không tải được URL). */
export async function inlineSlideImages(
  content: SlideDeckContent,
  resolveImage: (fileId: string) => Promise<Buffer | null>,
): Promise<SlideDeckContent> {
  const slides = content.slides as SlideLike[];
  const out: SlideLike[] = [];
  for (const slide of slides) {
    const img = slide.image;
    if (img?.fileId && !img.dataUrl) {
      const bytes = await resolveImage(img.fileId);
      const info = bytes ? probeImage(bytes) : null;
      if (bytes && info) {
        out.push({ ...slide, image: { ...img, dataUrl: `data:${info.mime};base64,${bytes.toString("base64")}` } });
        continue;
      }
    }
    out.push(slide);
  }
  return { ...content, slides: out as SlideDeckContent["slides"] };
}
