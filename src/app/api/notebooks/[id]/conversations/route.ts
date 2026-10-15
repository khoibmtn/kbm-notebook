import { ApiError, handleRoute } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { createConversation, listConversations, toConversationDto } from "@/server/chat/conversations";
import { createConversationSchema } from "@/lib/validators/chat";

type P = { id: string };

/** Các cuộc trò chuyện của chính người gọi trong sổ tay (mới nhất trước). Hội thoại là riêng tư theo người dùng. */
export const GET = handleRoute<P>(async (_req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "viewer");
  return { conversations: await listConversations(id, user.id) };
});

/** Tạo cuộc trò chuyện (viewer+ đều được chat). Tiêu đề tự đặt từ câu hỏi đầu tiên nếu không truyền. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "viewer");
  const raw = await req.text();
  let body: unknown = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "invalid_json", "Nội dung yêu cầu không phải JSON hợp lệ");
    }
  }
  const input = createConversationSchema.parse(body);
  const row = await createConversation(id, user.id, input.title);
  return Response.json({ conversation: toConversationDto(row) }, { status: 201 });
});
