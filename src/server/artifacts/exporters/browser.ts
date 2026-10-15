import "server-only";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

/**
 * Chromium dùng cho xuất PDF/PNG/SVG mind map. Thứ tự tìm tệp thực thi:
 * `PW_CHROMIUM_PATH` → `<PLAYWRIGHT_BROWSERS_PATH hoặc /opt/pw-browsers>/chromium-*​/chrome-linux/chrome`
 * (và headless_shell) → mặc định của Playwright. Cùng cấu hình với `playwright.config.ts` của dự án.
 */
export function resolveChromiumPath(): string | undefined {
  const explicit = process.env.PW_CHROMIUM_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers"].filter((p): p is string => Boolean(p));
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root).sort().reverse();
    for (const d of dirs) {
      const candidates = [
        path.join(root, d, "chrome-linux", "chrome"),
        path.join(root, d, "chrome-linux", "headless_shell"),
      ];
      if (/^chromium(_headless_shell)?-\d+$/.test(d)) {
        const hit = candidates.find((c) => existsSync(c));
        if (hit) return hit;
      }
    }
  }
  return undefined;
}

export class BrowserUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Không khởi chạy được Chromium: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`);
    this.name = "BrowserUnavailableError";
  }
}

/**
 * Chạy `fn` trong một trang Chromium sạch: chặn mọi request mạng (chỉ cho `data:`/`about:`), tắt tải ngoài.
 * Mỗi lần xuất mở một trình duyệt riêng rồi đóng — xuất ít khi xảy ra nên ưu tiên đơn giản/ổn định.
 */
export async function withPage<T>(
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
  opts: { viewport?: { width: number; height: number }; deviceScaleFactor?: number } = {},
): Promise<T> {
  let browser: Browser;
  try {
    browser = await chromium.launch({
      executablePath: resolveChromiumPath(),
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      timeout: 30_000,
    });
  } catch (err) {
    throw new BrowserUnavailableError(err);
  }
  try {
    const context = await browser.newContext({
      viewport: opts.viewport ?? { width: 1280, height: 900 },
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
      javaScriptEnabled: true,
    });
    await context.route("**/*", (route) => {
      const url = route.request().url();
      return url.startsWith("data:") || url.startsWith("about:") ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    return await fn(page, context);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
