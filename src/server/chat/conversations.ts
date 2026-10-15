import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { ApiError, isUuid } from "@/server/api/errors";
import { db } from "@/server/db";
import { conversations, messages, savedExchanges } from "@/server/db/schema";
import type { ChatMessageDto, ConversationDto } from "@/lib/chat";

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

export const MAX_TITLE_CHARS = 60;

export function toConversationDto(row: Conversation): ConversationDto {
  return {
    id: row.id,
    notebookId: row.notebookId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMessageDto(row: Message): ChatMessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    citations: row.citations ?? null,
    sourcesUsed: row.sourcesUsed ?? null,
    insufficientEvidence: row.insufficientEvidence,
    insufficientReason: (row.insufficientReason as ChatMessageDto["insufficientReason"]) ?? null,
    scope: row.scope ?? null,
    model: row.model,
    usage: (row.usage as ChatMessageDto["usage"]) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Tiêu đề tự động từ câu hỏi đầu tiên. */
export function titleFromQuestion(question: string, max = MAX_TITLE_CHARS): string {
  const t = question.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** Hội thoại riêng của từng người: người khác (kể cả admin) không thấy → 404. */
export async function getConversationOrThrow(userId: string, notebookId: string, conversationId: string): Promise<Conversation> {
  if (!isUuid(conversationId)) throw ApiError.notFound("Không tìm thấy cuộc trò chuyện");
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.notebookId, notebookId), eq(conversations.userId, userId)))
    .limit(1);
  if (!row) throw ApiError.notFound("Không tìm thấy cuộc trò chuyện");
  return row;
}

export async function listConversations(notebookId: string, userId: string): Promise<ConversationDto[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.notebookId, notebookId), eq(conversations.userId, userId)))
    .orderBy(desc(conversations.updatedAt));
  return rows.map(toConversationDto);
}

export async function createConversation(notebookId: string, userId: string, title?: string): Promise<Conversation> {
  const [row] = await db.insert(conversations).values({ notebookId, userId, title: title ?? null }).returning();
  return row;
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt), asc(messages.role));
}

export async function renameConversation(row: Conversation, title: string): Promise<Conversation> {
  const [updated] = await db.update(conversations).set({ title }).where(eq(conversations.id, row.id)).returning();
  return updated;
}

export async function deleteConversation(row: Conversation): Promise<void> {
  await db.delete(conversations).where(eq(conversations.id, row.id));
}

/** Tin nhắn thuộc hội thoại của người dùng trong notebook (cho save-exchange / to-note). */
export async function getMessageOrThrow(
  userId: string,
  notebookId: string,
  messageId: string,
): Promise<{ message: Message; conversation: Conversation }> {
  if (!isUuid(messageId)) throw ApiError.notFound("Không tìm thấy tin nhắn");
  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!msg) throw ApiError.notFound("Không tìm thấy tin nhắn");
  const conversation = await getConversationOrThrow(userId, notebookId, msg.conversationId);
  return { message: msg, conversation };
}

/** Câu hỏi (tin nhắn người dùng) ngay trước câu trả lời `answer`. */
export async function findQuestionFor(answer: Message): Promise<Message | null> {
  const all = await listMessages(answer.conversationId);
  const idx = all.findIndex((m) => m.id === answer.id);
  for (let i = idx - 1; i >= 0; i--) if (all[i].role === "user") return all[i];
  return null;
}

/** Xoá câu trả lời cũ khi tạo lại, trừ khi đã được lưu thành cặp hỏi-đáp. */
export async function deleteSupersededAnswer(messageId: string): Promise<void> {
  const [saved] = await db.select({ id: savedExchanges.id }).from(savedExchanges).where(eq(savedExchanges.answerMessageId, messageId)).limit(1);
  if (saved) return;
  await db.delete(messages).where(eq(messages.id, messageId));
}
