/**
 * Header bảo mật áp dụng cho mọi route (M-14). CSP ở đây CHỈ giới hạn nhúng khung / form / base / object — chưa giới hạn
 * `script-src` vì Next cần inline script (nonce là việc riêng). Chống clickjacking: chỉ cho phép nhúng cùng origin.
 */
export type HeaderEntry = { key: string; value: string };

export const GLOBAL_SECURITY_HEADERS: HeaderEntry[] = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
];

/** Trang chia sẻ có token trong URL: không bao giờ gửi Referer sang site khác. */
export const SHARE_PAGE_HEADERS: HeaderEntry[] = [{ key: "Referrer-Policy", value: "no-referrer" }];

export function securityHeaders(): { source: string; headers: HeaderEntry[] }[] {
  return [
    { source: "/:path*", headers: GLOBAL_SECURITY_HEADERS },
    { source: "/s/:path*", headers: SHARE_PAGE_HEADERS },
    { source: "/a/:path*", headers: SHARE_PAGE_HEADERS },
    { source: "/invite/:path*", headers: SHARE_PAGE_HEADERS },
  ];
}
