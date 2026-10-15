import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { promises as dnsPromises } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { isPrivateIp } from "@/server/net/ip-policy";
import { IngestError } from "./errors";

/* -------------------------------------------------------------------------- */
/* Kiểm tra địa chỉ IP riêng / loopback                                        */
/* -------------------------------------------------------------------------- */

// Chính sách IP dùng chung với connectors/http.ts: xem src/server/net/ip-policy.ts
export { isPrivateIp };

const BLOCKED_HOST_RE = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

function hostnameForIp(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * Chặn SSRF: chỉ http/https, không kèm user:pass, host không phải IP riêng/loopback và DNS không trỏ vào dải riêng.
 * Trả URL đã parse. Ném `IngestError` (permanent) khi bị chặn.
 */
export async function assertPublicUrl(raw: string, isBlocked: (ip: string) => boolean = isPrivateIp): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new IngestError("URL không hợp lệ");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new IngestError("Chỉ hỗ trợ liên kết http/https");
  if (url.username || url.password) throw new IngestError("URL không được chứa thông tin đăng nhập");
  const host = hostnameForIp(url.hostname);
  if (!host) throw new IngestError("URL không hợp lệ");
  if (isIP(host)) {
    if (isBlocked(host)) throw new IngestError("Không cho phép truy cập địa chỉ nội bộ");
    return url;
  }
  if (BLOCKED_HOST_RE.test(host)) throw new IngestError("Không cho phép truy cập địa chỉ nội bộ");
  let addrs: LookupAddress[];
  try {
    addrs = await dnsPromises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new IngestError("Không phân giải được tên miền", { permanent: false });
  }
  if (addrs.length === 0 || addrs.some((a) => isBlocked(a.address))) {
    throw new IngestError("Không cho phép truy cập địa chỉ nội bộ");
  }
  return url;
}

/* -------------------------------------------------------------------------- */
/* Fetch an toàn                                                               */
/* -------------------------------------------------------------------------- */

export const FETCH_TIMEOUT_MS = 15_000;
export const FETCH_MAX_BYTES = 10 * 1024 * 1024;
export const FETCH_USER_AGENT = "Mozilla/5.0 (compatible; KBMNotebookBot/1.0; +https://kbm-notebook.local)";

export type FetchedPage = { finalUrl: string; contentType: string; body: Buffer; status: number };

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** `lookup` cho http(s).request: phân giải rồi từ chối nếu có địa chỉ riêng (chống DNS rebinding). */
function guardedLookup(
  isBlocked: (ip: string) => boolean,
  hostname: string,
  options: { all?: boolean; family?: number | string },
  cb: LookupCb,
): void {
  dnsLookup(hostname, { all: true, verbatim: true, family: typeof options.family === "number" ? options.family : 0 }, (err, addrs) => {
    if (err) return cb(err, "", 0);
    if (!addrs.length || addrs.some((a) => isBlocked(a.address))) {
      const e: NodeJS.ErrnoException = new Error("Không cho phép truy cập địa chỉ nội bộ");
      e.code = "EBLOCKED";
      return cb(e, "", 0);
    }
    if (options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

function decodeStream(res: http.IncomingMessage): Readable {
  const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") return res.pipe(createGunzip());
  if (enc === "deflate") return res.pipe(createInflate());
  if (enc === "br") return res.pipe(createBrotliDecompress());
  return res;
}

function requestOnce(
  url: URL,
  timeoutMs: number,
  maxBytes: number,
  isBlocked: (ip: string) => boolean,
): Promise<{ res: http.IncomingMessage; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: ((h: string, o: { all?: boolean; family?: number | string }, cb: LookupCb) =>
          guardedLookup(isBlocked, h, o, cb)) as unknown as http.RequestOptions["lookup"],
        headers: {
          "User-Agent": FETCH_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/pdf,text/plain,application/json;q=0.9,*/*;q=0.5",
          "Accept-Language": "vi,en;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return done(() => resolve({ res, body: Buffer.alloc(0) }));
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          return done(() => reject(new IngestError(`Trang vượt quá ${Math.round(maxBytes / 1024 / 1024)}MB`)));
        }
        const stream = decodeStream(res);
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            return done(() => reject(new IngestError(`Trang vượt quá ${Math.round(maxBytes / 1024 / 1024)}MB`)));
          }
          chunks.push(c);
        });
        stream.on("end", () => done(() => resolve({ res, body: Buffer.concat(chunks) })));
        stream.on("error", (e) => done(() => reject(new IngestError("Không đọc được nội dung trang", { permanent: false, cause: e }))));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(() => reject(new IngestError("Hết thời gian chờ khi tải trang (15 giây)", { permanent: false })));
    }, timeoutMs);
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EBLOCKED") return done(() => reject(new IngestError("Không cho phép truy cập địa chỉ nội bộ")));
      done(() => reject(new IngestError(`Không tải được trang: ${e.message}`, { permanent: false, cause: e })));
    });
    req.end();
  });
}

/**
 * Tải URL với: kiểm tra SSRF ở mỗi bước (kể cả redirect + lúc kết nối), timeout 15s, tối đa 10MB, User-Agent.
 */
export async function safeFetch(
  rawUrl: string,
  opts: {
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
    /** Chỉ dùng trong test: thay luật chặn IP (mặc định chặn dải riêng/loopback). */
    isBlockedIp?: (ip: string) => boolean;
  } = {},
): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? FETCH_MAX_BYTES;
  const isBlocked = opts.isBlockedIp ?? isPrivateIp;
  const deadline = Date.now() + timeoutMs;
  let url = await assertPublicUrl(rawUrl, isBlocked);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    const remaining = Math.max(1000, deadline - Date.now());
    const { res, body } = await requestOnce(url, remaining, maxBytes, isBlocked);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      let next: string;
      try {
        next = new URL(res.headers.location, url).toString();
      } catch {
        throw new IngestError("Chuyển hướng không hợp lệ");
      }
      url = await assertPublicUrl(next, isBlocked);
      continue;
    }
    if (status < 200 || status >= 300) {
      throw new IngestError(`Máy chủ trả về HTTP ${status}`, { permanent: status >= 400 && status < 500 && status !== 429 });
    }
    return { finalUrl: url.toString(), contentType: String(res.headers["content-type"] ?? ""), body, status };
  }
  throw new IngestError("Quá nhiều lần chuyển hướng");
}
