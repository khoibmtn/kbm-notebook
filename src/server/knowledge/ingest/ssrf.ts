import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { promises as dnsPromises } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { IngestError } from "./errors";

/* -------------------------------------------------------------------------- */
/* Kiểm tra địa chỉ IP riêng / loopback                                        */
/* -------------------------------------------------------------------------- */

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}

function inV4(ip: number, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
}

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, metadata cloud
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

/** Mở rộng IPv6 về 8 nhóm 16-bit (hỗ trợ `::` và đuôi IPv4). */
function expandV6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone);
  const v4tail = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4tail) {
    const n = ipv4ToInt(v4tail[1]);
    addr = addr.slice(0, addr.length - v4tail[1].length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const nums = groups.map((g) => parseInt(g, 16));
  return nums.length === 8 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? nums : null;
}

/** true nếu IP thuộc dải không được phép truy cập từ server (private, loopback, link-local, multicast…). */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => inV4(n, base, bits));
  }
  if (kind === 6) {
    const g = expandV6(ip);
    if (!g) return true;
    if (g.every((x) => x === 0)) return true; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
    // IPv4-mapped ::ffff:a.b.c.d và IPv4-compatible ::a.b.c.d
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
      return isPrivateIp(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    }
    // NAT64 64:ff9b::/96
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
      return isPrivateIp(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    }
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // tài liệu
    return false;
  }
  return true; // không phải IP hợp lệ → coi như chặn
}

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
