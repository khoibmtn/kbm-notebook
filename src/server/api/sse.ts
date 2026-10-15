import "server-only";

const encoder = new TextEncoder();

/** Một khung SSE: `event: <type>\ndata: <json>\n\n`. */
export function sseFrame(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

type TypedEvent = { type: string };

/**
 * Biến một async generator sự kiện thành Response `text/event-stream`.
 * Client ngắt kết nối (fetch bị abort) → `signal` được truyền cho generator để dừng sớm.
 */
export function sseResponse<E extends TypedEvent>(
  source: (signal: AbortSignal) => AsyncGenerator<E>,
  reqSignal?: AbortSignal,
): Response {
  const ac = new AbortController();
  reqSignal?.addEventListener("abort", () => ac.abort(), { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (chunk: Uint8Array) => {
        if (!open) return;
        try {
          controller.enqueue(chunk);
        } catch {
          open = false;
        }
      };
      try {
        for await (const ev of source(ac.signal)) {
          const { type, ...rest } = ev;
          send(sseFrame(type, rest));
        }
      } catch (err) {
        console.error("[sse] stream failed", err);
        send(sseFrame("error", { code: "internal_error", message: "Đã xảy ra lỗi máy chủ" }));
      } finally {
        if (open) {
          try {
            controller.close();
          } catch {
            /* đã đóng */
          }
        }
      }
    },
    cancel() {
      ac.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
