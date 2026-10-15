export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

/** Gọi API nội bộ, trả JSON; lỗi chuẩn `{ error: { code, message } }` → ApiClientError. */
export async function api<T = unknown>(path: string, init: Omit<RequestInit, "body"> & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    credentials: "same-origin",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiClientError(res.status, err?.code ?? "unknown", err?.message ?? `Lỗi ${res.status}`);
  }
  return data as T;
}

export function errorMessage(e: unknown, fallback = "Đã xảy ra lỗi"): string {
  return e instanceof Error ? e.message : fallback;
}
