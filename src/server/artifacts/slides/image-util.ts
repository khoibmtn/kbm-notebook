/** Đọc kích thước ảnh (PNG/JPEG/GIF/WebP) từ header, không cần thư viện ngoài. */
export type ImageInfo = { mime: string; width: number; height: number };

export function probeImage(buf: Buffer): ImageInfo | null {
  if (buf.length < 24) return null;
  // PNG
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { mime: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF
  if (buf.toString("ascii", 0, 3) === "GIF") {
    return { mime: "image/gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: "image/jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { mime: "image/jpeg", width: 0, height: 0 };
  }
  // WebP
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X") {
      return { mime: "image/webp", width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (kind === "VP8 ") {
      return { mime: "image/webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (kind === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { mime: "image/webp", width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

/** Tách data URL → { mime, bytes }; trả null nếu không hợp lệ. */
export function parseDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:([\w.+/-]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!m) return null;
  try {
    return { mime: m[1], bytes: Buffer.from(m[2], "base64") };
  } catch {
    return null;
  }
}
