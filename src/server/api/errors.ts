import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { ZodError, type ZodType } from "zod";

export type ErrorCode =
  | "bad_request"
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "ai_not_configured"
  | "rate_limited"
  | "internal_error"
  | (string & {});

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = "Yêu cầu không hợp lệ", code: ErrorCode = "bad_request") {
    return new ApiError(400, code, message);
  }
  static unauthorized(message = "Bạn cần đăng nhập") {
    return new ApiError(401, "unauthorized", message);
  }
  static forbidden(message = "Bạn không có quyền thực hiện thao tác này") {
    return new ApiError(403, "forbidden", message);
  }
  static notFound(message = "Không tìm thấy") {
    return new ApiError(404, "not_found", message);
  }
  static conflict(message = "Xung đột dữ liệu", code: ErrorCode = "conflict") {
    return new ApiError(409, code, message);
  }
}

/** Ngữ cảnh request (headers) để getSession() dùng được cả khi test gọi handler trực tiếp. */
export const requestContext = new AsyncLocalStorage<{ headers: Headers }>();

type ErrorLike = { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown; name?: unknown };

/** Chuyển mọi lỗi thành Response chuẩn `{ error: { code, message } }`. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json(
      { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "validation_error",
          message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
          details: err.issues,
        },
      },
      { status: 400 },
    );
  }
  const e = err as ErrorLike;
  // AiNotConfiguredError (không import trực tiếp để tránh phụ thuộc vòng)
  if (e && e.name === "AiNotConfiguredError") {
    return Response.json(
      { error: { code: "ai_not_configured", message: String(e.message ?? "Chưa cấu hình AI") } },
      { status: 412 },
    );
  }
  if (e && e.name === "AiProviderError") {
    const upstream = typeof e.status === "number" ? e.status : null;
    const status = upstream === 429 ? 429 : upstream && upstream >= 400 && upstream < 500 ? 400 : 502;
    return Response.json(
      { error: { code: "ai_provider_error", message: String(e.message ?? "Lỗi từ nhà cung cấp AI") } },
      { status },
    );
  }
  // Lỗi từ better-auth (APIError) có status số
  const status = typeof e?.statusCode === "number" ? e.statusCode : typeof e?.status === "number" ? e.status : null;
  if (status && status >= 400 && status < 500) {
    return Response.json(
      { error: { code: String(e.code ?? "bad_request").toLowerCase(), message: String(e.message ?? "Lỗi") } },
      { status },
    );
  }
  console.error("[api] unhandled error", err);
  return Response.json(
    { error: { code: "internal_error", message: "Đã xảy ra lỗi máy chủ" } },
    { status: 500 },
  );
}

type RouteCtx<P> = { params: Promise<P> };

/**
 * Bọc route handler: bắt lỗi → `{ error: { code, message } }`, đặt ngữ cảnh request cho getSession().
 * Handler có thể trả Response hoặc object (tự bọc Response.json).
 */
export function handleRoute<P = Record<string, string>>(
  fn: (req: Request, ctx: RouteCtx<P>) => Promise<Response | unknown> | Response | unknown,
) {
  return async (req: Request, ctx: RouteCtx<P> = { params: Promise.resolve({} as P) }): Promise<Response> => {
    try {
      const result = await requestContext.run({ headers: req.headers }, async () => fn(req, ctx));
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Đọc JSON body và validate bằng zod. */
export async function parseBody<T>(schema: ZodType<T>, req: Request): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Nội dung yêu cầu không phải JSON hợp lệ");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

/** Validate query string. */
export function parseQuery<T>(schema: ZodType<T>, req: Request): T {
  const url = new URL(req.url);
  const obj: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    obj[k] = v;
  });
  const parsed = schema.safeParse(obj);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

/** Validate param động (uuid). Trả 404 nếu sai định dạng để không lộ thông tin. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}
