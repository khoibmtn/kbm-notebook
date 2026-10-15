import { handleRoute } from "@/server/api/errors";
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
  const input = createConversationSchema.parse(raw.trim() ? JSON.parse(raw) : {});
  const row = await createConversation(id, user.id, input.title);
  return Response.json({ conversation: toConversationDto(row) }, { status: 201 });
});
