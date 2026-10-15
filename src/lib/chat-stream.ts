import { ApiClientError } from "@/lib/api-client";
import type { AskStreamEvent } from "@/lib/chat";

type Frame = { event: string; data: string };

/** Tách các khung SSE hoàn chỉnh (`event:` + `data:` kết thúc bằng dòng trống); phần dư chưa đủ khung trả về trong `rest`. */
export function splitSseFrames(buffer: string): { frames: Frame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const frames: Frame[] = [];
  for (const part of parts) {
    let event = "message";
    const data: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length > 0) frames.push({ event, data: data.join("\n") });
  }
  return { frames, rest };
}

/** Khung SSE → sự kiện có kiểu; bỏ qua khung hỏng / loại lạ. */
export function frameToEvent(frame: Frame): AskStreamEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  switch (frame.event) {
    case "meta":
    case "scope_adjusted":
    case "delta":
    case "done":
    case "error":
      return { type: frame.event, ...(payload as object) } as AskStreamEvent;
    default:
      return null;
  }
}

/** Đọc luồng SSE của một `Response` thành các sự kiện. */
export async function* readAskStream(res: Response): AsyncGenerator<AskStreamEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = splitSseFrames(buffer);
      buffer = rest;
      for (const f of frames) {
        const ev = frameToEvent(f);
        if (ev) yield ev;
      }
    }
    buffer += decoder.decode();
    const { frames } = splitSseFrames(buffer + "\n\n");
    for (const f of frames) {
      const ev = frameToEvent(f);
      if (ev) yield ev;
    }
  } finally {
    reader.releaseLock();
  }
}

export type AskBody = {
  question: string;
  scope: { sourceIds?: string[]; connectionIds?: string[]; useWeb?: boolean };
  model?: string;
  regenerate?: boolean;
};

/** Gửi câu hỏi và trả về luồng sự kiện. Lỗi HTTP (404/412/429…) được ném dạng `ApiClientError` trước khi có sự kiện nào. */
export async function askStream(
  notebookId: string,
  conversationId: string,
  body: AskBody,
  signal?: AbortSignal,
): Promise<AsyncGenerator<AskStreamEvent>> {
  const res = await fetch(`/api/notebooks/${notebookId}/conversations/${conversationId}/messages`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let code = "unknown";
    let message = `Lỗi ${res.status}`;
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } };
      code = data.error?.code ?? code;
      message = data.error?.message ?? message;
    } catch {
      /* không phải JSON */
    }
    throw new ApiClientError(res.status, code, message);
  }
  return readAskStream(res);
}
