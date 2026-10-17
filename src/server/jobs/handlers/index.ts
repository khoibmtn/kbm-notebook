import "server-only";
import { registerJobHandler } from "../worker";

/** Handler tối thiểu để kiểm tra pipeline job. Các phase sau đăng ký thêm handler thật ở đây. */
export function registerBuiltinHandlers(): void {
  registerJobHandler<{ fail?: boolean; steps?: number } | undefined>("noop", async ({ payload, progress }) => {
    const steps = payload?.steps ?? 1;
    for (let i = 1; i <= steps; i++) await progress((i / steps) * 100);
    if (payload?.fail) throw new Error("noop: lỗi chủ đích");
    return { ok: true };
  });
}
