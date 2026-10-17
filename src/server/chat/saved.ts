import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import type { Role } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { messages, savedExchanges } from "@/server/db/schema";
import { privateSourceIdsAmong } from "@/server/knowledge/sources";
import { answerToNoteMarkdown } from "@/server/notes/from-chat";
import { createNote, toNoteDto } from "@/server/notes/service";
import type { ChatMessageDto } from "@/lib/chat";
import type { NoteDto } from "@/lib/notes";
import { findQuestionFor, getMessageOrThrow, titleFromQuestion, toMessageDto } from "./conversations";

export type SavedExchangeDto = {
  id: string;
  notebookId: string;
  noteId: string | null;
  createdAt: string;
  question: ChatMessageDto;
  answer: ChatMessageDto;
};

/** Lấy câu trả lời AI của hội thoại (đúng conversationId) cùng câu hỏi ngay trước nó. */
async function resolveExchange(userId: string, notebookId: string, conversationId: string, answerMessageId: string) {
  const { message: answer, conversation } = await getMessageOrThrow(userId, notebookId, answerMessageId);
  if (conversation.id !== conversationId) throw ApiError.notFound("Không tìm thấy tin nhắn");
  if (answer.role !== "assistant") throw ApiError.badRequest("Chỉ có thể lưu câu trả lời của AI");
  const question = await findQuestionFor(answer);
  if (!question) throw ApiError.notFound("Không tìm thấy câu hỏi tương ứng");
  return { answer, question };
}

function toDto(row: typeof savedExchanges.$inferSelect, question: typeof messages.$inferSelect, answer: typeof messages.$inferSelect): SavedExchangeDto {
  return {
    id: row.id,
    notebookId: row.notebookId,
    noteId: row.noteId,
    createdAt: row.createdAt.toISOString(),
    question: toMessageDto(question),
    answer: toMessageDto(answer),
  };
}

/** Lưu cặp hỏi-đáp; lưu lại cùng một câu trả lời thì trả bản đã có. */
export async function saveExchange(input: { userId: string; notebookId: string; conversationId: string; answerMessageId: string }): Promise<SavedExchangeDto> {
  const { answer, question } = await resolveExchange(input.userId, input.notebookId, input.conversationId, input.answerMessageId);
  const [existing] = await db
    .select()
    .from(savedExchanges)
    .where(and(eq(savedExchanges.answerMessageId, answer.id), eq(savedExchanges.userId, input.userId)))
    .limit(1);
  if (existing) return toDto(existing, question, answer);
  const [row] = await db
    .insert(savedExchanges)
    .values({ notebookId: input.notebookId, userId: input.userId, questionMessageId: question.id, answerMessageId: answer.id })
    .returning();
  return toDto(row, question, answer);
}

export async function listSavedExchanges(notebookId: string, userId: string): Promise<SavedExchangeDto[]> {
  const rows = await db
    .select()
    .from(savedExchanges)
    .where(and(eq(savedExchanges.notebookId, notebookId), eq(savedExchanges.userId, userId)))
    .orderBy(desc(savedExchanges.createdAt));
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.questionMessageId, r.answerMessageId]))];
  const msgs = await db.select().from(messages).where(inArray(messages.id, ids));
  const byId = new Map(msgs.map((m) => [m.id, m]));
  return rows.flatMap((r) => {
    const q = byId.get(r.questionMessageId);
    const a = byId.get(r.answerMessageId);
    return q && a ? [toDto(r, q, a)] : [];
  });
}

/** Tạo ghi chú từ câu trả lời AI: tiêu đề = câu hỏi, nội dung = câu trả lời + danh sách nguồn ở cuối. */
export async function answerToNote(input: {
  userId: string;
  role: Role;
  notebookId: string;
  conversationId: string;
  answerMessageId: string;
}): Promise<NoteDto> {
  const { answer, question } = await resolveExchange(input.userId, input.notebookId, input.conversationId, input.answerMessageId);
  // Câu trả lời dựa trên bằng chứng từ nguồn RIÊNG TƯ → ghi chú mặc định riêng tư (không lộ khi chia sẻ sổ tay).
  const evidenceSourceIds = (answer.citations ?? []).flatMap((c) => (c.sourceId ? [c.sourceId] : []));
  const usesPrivate = (await privateSourceIdsAmong(evidenceSourceIds)).size > 0;
  const row = await createNote({
    notebookId: input.notebookId,
    userId: input.userId,
    title: titleFromQuestion(question.content, 100),
    contentMd: answerToNoteMarkdown(answer.content, answer.citations ?? []),
    visibility: usesPrivate ? "private" : "shared",
    origin: "chat",
    originRef: { conversationId: answer.conversationId, messageId: answer.id },
  });
  // Nếu cặp hỏi-đáp này đã được lưu thì liên kết với ghi chú vừa tạo.
  await db
    .update(savedExchanges)
    .set({ noteId: row.id })
    .where(and(eq(savedExchanges.answerMessageId, answer.id), eq(savedExchanges.userId, input.userId)));
  return toNoteDto(row, { userId: input.userId, role: input.role });
}
