import { z } from "zod";
import { handleRoute, parseBody, parseQuery } from "@/server/api/errors";
import { sseResponse } from "@/server/api/sse";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { askQuestion, prepareAsk } from "@/server/chat/ask";
import { askSchema } from "@/lib/validators/chat";

type P = { id: string; conversationId: string };

const querySchema = z.object({ stream: z.enum(["0", "1", "false", "true"]).optional() });

/**
 * Đặt câu hỏi trong cuộc trò chuyện. Mặc định trả SSE (`meta` · `scope_adjusted` · `delta` · `done` · `error`);
 * `?stream=0` trả toàn bộ kết quả dạng JSON. Mọi lỗi trước khi bắt đầu trả lời (404/412/429…) là HTTP lỗi chuẩn.
 */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id, conversationId } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "viewer");
  const input = await parseBody(askSchema, req);
  const { stream } = parseQuery(querySchema, req);
  const base = {
    userId: user.id,
    notebookId: id,
    conversationId,
    question: input.question,
    scope: input.scope,
    model: input.model,
    regenerate: input.regenerate,
  };

  if (stream === "0" || stream === "false") return askQuestion(base);

  const prepared = await prepareAsk(base);
  return sseResponse((signal) => prepared.run(signal), req.signal);
});
