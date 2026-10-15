import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http, { type IncomingHttpHeaders } from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { ApiError } from "@/server/api/errors";
import { privateConnectorHostsAllowed } from "@/server/env";
import { isPrivateIp } from "@/server/knowledge/ingest/ssrf";

/**
 * HTTP client dùng cho Bridge (và mọi URL do người dùng nhập).
 *
 * Khác `safeFetch` của pipeline ingest: có POST/Bearer/multipart, KHÔNG theo redirect, và cho phép **tuỳ chọn** gọi tới
 * địa chỉ riêng/LAN/localhost (`allowPrivateHosts`) vì người dùng chạy Bridge trên chính máy của họ. Ngay cả khi cho phép,
 * vẫn luôn chặn: link-local (metadata đám mây 169.254.x.x, fe80::/10), 0.0.0.0/8, multicast/reserved.
 */

export const CONNECTOR_DEFAULT_TIMEOUT_MS = 20_000;
export const CONNECTOR_DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/** Dải luôn bị chặn, kể cả khi người dùng cho phép địa chỉ nội bộ. */
const ALWAYS_BLOCKED = new BlockList();
ALWAYS_BLOCKED.addSubnet("0.0.0.0", 8, "ipv4");
ALWAYS_BLOCKED.addSubnet("169.254.0.0", 16, "ipv4");
ALWAYS_BLOCKED.addSubnet("224.0.0.0", 4, "ipv4");
ALWAYS_BLOCKED.addSubnet("240.0.0.0", 4, "ipv4");
ALWAYS_BLOCKED.addSubnet("fe80::", 10, "ipv6");
ALWAYS_BLOCKED.addSubnet("ff00::", 8, "ipv6");
ALWAYS_BLOCKED.addAddress("::", "ipv6");

export function isAlwaysBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 0) return true;
  return ALWAYS_BLOCKED.check(ip, kind === 4 ? "ipv4" : "ipv6");
}

const PRIVATE_NAME_RE = /(^|\.)(localhost|local|internal|localdomain|home\.arpa|lan)$/i;

function bareHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * URL này có trỏ tới địa chỉ nội bộ/riêng không? Chỉ xét phần chữ của host (IP literal, `localhost`, `*.local`…);
 * tên miền công khai nhưng phân giải về IP riêng sẽ bị chặn lúc kết nối nếu chưa được cho phép.
 */
export function isPrivateHostUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = bareHost(url.hostname);
  if (isIP(host)) return isPrivateIp(host);
  return PRIVATE_NAME_RE.test(host) || !host.includes(".");
}

/**
 * Kiểm tra cú pháp + chính sách trước khi lưu/gọi (không phân giải DNS; phần đó do `lookup` lúc kết nối đảm nhiệm).
 * Ném `ApiError(400)` với thông báo tiếng Việt.
 */
export function assertConnectorUrl(raw: string, opts: { allowPrivateHosts: boolean }): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ApiError(400, "invalid_url", "URL không hợp lệ");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, "invalid_url", "Chỉ hỗ trợ địa chỉ http:// hoặc https://");
  }
  if (url.username || url.password) {
    throw new ApiError(400, "invalid_url", "URL không được chứa tên đăng nhập/mật khẩu (hãy dùng ô Token)");
  }
  const host = bareHost(url.hostname);
  if (!host) throw new ApiError(400, "invalid_url", "URL không hợp lệ");
  if (isIP(host) && isAlwaysBlockedIp(host)) {
    throw new ApiError(400, "blocked_url", "Không cho phép địa chỉ link-local / metadata / không hợp lệ");
  }
  if (isPrivateHostUrl(url.toString())) {
    if (!privateConnectorHostsAllowed()) {
      throw new ApiError(400, "private_host_not_allowed", "Máy chủ này không cho phép kết nối tới địa chỉ nội bộ/LAN (CONNECTORS_ALLOW_PRIVATE_HOSTS=false)");
    }
    if (!opts.allowPrivateHosts) {
      throw new ApiError(
        400,
        "private_host_requires_consent",
        "Địa chỉ này là localhost/mạng nội bộ. Hãy bật “Cho phép địa chỉ nội bộ” (Bridge chạy trên máy của bạn) rồi thử lại",
      );
    }
  }
  return url;
}

export type ConnectorHttpRequest = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: Buffer | string;
  timeoutMs?: number;
  maxBytes?: number;
  allowPrivateHosts: boolean;
};

export type ConnectorHttpResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function guardedLookup(allowPrivate: boolean, hostname: string, options: { all?: boolean; family?: number | string }, cb: LookupCb): void {
  dnsLookup(hostname, { all: true, verbatim: true, family: typeof options.family === "number" ? options.family : 0 }, (err, addrs) => {
    if (err) return cb(err, "", 0);
    const blocked = (ip: string) => isAlwaysBlockedIp(ip) || (!allowPrivate && isPrivateIp(ip));
    if (!addrs.length || addrs.some((a) => blocked(a.address))) {
      const e: NodeJS.ErrnoException = new Error("Địa chỉ không được phép");
      e.code = "EBLOCKED";
      return cb(e, "", 0);
    }
    if (options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

/** Gọi HTTP(S) một lần (không redirect). Lỗi mạng/timeout/quá lớn → `ApiError(502, 'connector_error')`. */
export async function connectorHttp(req: ConnectorHttpRequest): Promise<ConnectorHttpResponse> {
  const url = assertConnectorUrl(req.url, { allowPrivateHosts: req.allowPrivateHosts });
  const timeoutMs = req.timeoutMs ?? CONNECTOR_DEFAULT_TIMEOUT_MS;
  const maxBytes = req.maxBytes ?? CONNECTOR_DEFAULT_MAX_BYTES;
  const lib = url.protocol === "https:" ? https : http;
  const where = url.host;

  return new Promise<ConnectorHttpResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const fail = (message: string) => finish(() => reject(new ApiError(502, "connector_error", message)));

    const body = req.body === undefined ? undefined : typeof req.body === "string" ? Buffer.from(req.body, "utf8") : req.body;
    const request = lib.request(
      url,
      {
        method: req.method ?? "GET",
        lookup: ((h: string, o: { all?: boolean; family?: number | string }, cb: LookupCb) =>
          guardedLookup(req.allowPrivateHosts, h, o, cb)) as unknown as http.RequestOptions["lookup"],
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "identity",
          ...(body ? { "Content-Length": String(body.length) } : {}),
          ...req.headers,
        },
      },
      (res) => {
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          return fail(`Phản hồi từ ${where} vượt quá ${Math.round(maxBytes / 1024 / 1024)}MB`);
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            request.destroy();
            return fail(`Phản hồi từ ${where} vượt quá ${Math.round(maxBytes / 1024 / 1024)}MB`);
          }
          chunks.push(c);
        });
        res.on("end", () => finish(() => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })));
        res.on("error", (e) => fail(`Đọc phản hồi từ ${where} thất bại: ${e.message}`));
      },
    );
    const timer = setTimeout(() => {
      request.destroy();
      fail(`Hết thời gian chờ ${where} (${Math.round(timeoutMs / 1000)} giây)`);
    }, timeoutMs);
    request.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EBLOCKED") {
        return fail(
          req.allowPrivateHosts
            ? `Địa chỉ ${where} thuộc dải bị chặn (link-local/metadata)`
            : `Địa chỉ ${where} phân giải về mạng nội bộ. Hãy bật “Cho phép địa chỉ nội bộ” nếu Bridge chạy trên máy của bạn`,
        );
      }
      if (e.code === "ECONNREFUSED") return fail(`Không kết nối được tới ${where} (bị từ chối). Bridge đã chạy chưa?`);
      if (e.code === "ENOTFOUND") return fail(`Không phân giải được tên miền ${where}`);
      fail(`Không kết nối được tới ${where}: ${e.message || e.code || "lỗi mạng"}`);
    });
    if (body) request.write(body);
    request.end();
  });
}
