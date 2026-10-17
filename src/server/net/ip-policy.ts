import "server-only";
import { isIP } from "node:net";

/**
 * Chính sách địa chỉ IP dùng chung cho mọi nơi máy chủ gọi tới URL do người dùng cung cấp
 * (tải URL làm nguồn — `knowledge/ingest/ssrf.ts`, NotebookLM Bridge — `connectors/http.ts`).
 *
 * Hai mức:
 * - `isPrivateIp`: mọi dải không công khai (private, loopback, link-local, CGNAT, multicast, tài liệu…). Ingest chặn tất cả.
 * - `isAlwaysBlockedIp`: tập con nguy hiểm nhất, KHÔNG BAO GIỜ cho phép kể cả khi admin bật `CONNECTORS_ALLOW_PRIVATE_HOSTS`:
 *   metadata đám mây (169.254.0.0/16, 100.64.0.0/10 gồm Alibaba 100.100.100.200, 192.0.0.0/24 gồm Oracle 192.0.0.192,
 *   fd00:ec2::/32 gồm AWS IMDS IPv6), "this network", multicast, reserved, link-local/multicast IPv6, Teredo.
 * Địa chỉ IPv6 nhúng IPv4 (mapped ::ffff:a.b.c.d, NAT64 64:ff9b::/96, 6to4 2002::/16) được giải ra và kiểm theo IPv4.
 */

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}

function inV4(ip: number, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
}

/** Dải IPv4 không công khai. */
const PRIVATE_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT (gồm metadata Alibaba 100.100.100.200)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, metadata đám mây
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol (gồm metadata Oracle 192.0.0.192)
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

/** Dải IPv4 luôn bị chặn (không có ngoại lệ). */
const ALWAYS_BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["100.64.0.0", 10],
  ["169.254.0.0", 16],
  ["192.0.0.0", 24],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** Mở rộng IPv6 về 8 nhóm 16-bit (hỗ trợ `::` và đuôi IPv4). */
export function expandV6(ip: string): number[] | null {
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

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** IPv4 nhúng trong IPv6 (mapped / compatible / NAT64 / 6to4), nếu có. */
function embeddedV4(g: number[]): string | null {
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return v4From(g[6], g[7]); // ::ffff:a.b.c.d, ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4From(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return v4From(g[1], g[2]); // 6to4
  return null;
}

/** true nếu IP thuộc dải không được phép truy cập từ server (private, loopback, link-local, multicast…). */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => inV4(n, base, bits));
  }
  if (kind === 6) {
    const g = expandV6(ip);
    if (!g) return true;
    if (g.every((x) => x === 0)) return true; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
    const v4 = embeddedV4(g);
    if (v4) return isPrivateIp(v4);
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (gồm fd00:ec2::/32)
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast
    if (g[0] === 0x2001 && g[1] === 0x0000) return true; // Teredo
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // tài liệu
    return false;
  }
  return true; // không phải IP hợp lệ → coi như chặn
}

/** true nếu IP thuộc tập luôn bị chặn (metadata đám mây, reserved…), kể cả khi cho phép địa chỉ nội bộ. */
export function isAlwaysBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 0) return true;
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return ALWAYS_BLOCKED_V4.some(([base, bits]) => inV4(n, base, bits));
  }
  const g = expandV6(ip);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1 (loopback: chỉ "private", không phải "luôn chặn")
  const v4 = embeddedV4(g);
  if (v4) return isAlwaysBlockedIp(v4);
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8
  if (g[0] === 0xfd00 && g[1] === 0x0ec2) return true; // fd00:ec2::/32 — AWS IMDS IPv6
  if (g[0] === 0x2001 && g[1] === 0x0000) return true; // Teredo
  return false;
}

/** Tên miền chỉ có ý nghĩa nội bộ (không có chấm, hoặc hậu tố nội bộ). */
const PRIVATE_NAME_RE = /(^|\.)(localhost|local|internal|localdomain|home\.arpa|lan)$/i;

export function bareHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/** Phần chữ của host có phải tên nội bộ không (localhost, *.local, tên không có dấu chấm…). Không phân giải DNS. */
export function isPrivateHostName(host: string): boolean {
  return PRIVATE_NAME_RE.test(host) || !host.includes(".");
}
