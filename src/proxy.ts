import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const AUTH_PAGES = ["/login", "/register"];

/**
 * Chuyển người chưa đăng nhập khỏi các route trong (app) về /login (kiểm tra nhanh cookie;
 * session thật được xác thực lại trong layout/route handler).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;


  const hasSession = Boolean(getSessionCookie(request));

  // Trang đăng nhập/đăng ký: KHÔNG chuyển hướng theo cookie (cookie cũ/hết hạn phía DB sẽ gây vòng lặp /login ⇄ /).
  // Việc "đã đăng nhập thì về trang chủ" do chính trang xác thực session thật (xem (auth)/login và (auth)/register).
  if (AUTH_PAGES.includes(pathname)) return NextResponse.next();

  if (!hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Chỉ áp dụng cho route trang của (app): /, /settings, /n/**. API (kiểm tra origin trong handleRoute — không đi qua
  // proxy vì Next đệm body ở middleware, làm hỏng upload lớn), /invite, tệp tĩnh không đi qua proxy.
  matcher: ["/", "/settings/:path*", "/n/:path*", "/login", "/register"],
};
