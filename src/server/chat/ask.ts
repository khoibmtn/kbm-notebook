import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { enforceRateLimit } from "@/server/api/rate-limit";
import { getAiProviderForUser, getUserModels } from "@/server/ai";
import { AiProviderError, type AiProvider, type ChatMsg, type Usage } from "@/server/ai/provider";
import { postCheckAnswer } from "@/server/ai/citations";
import { buildContext } from "@/server/ai/context";
import { composeChatSystem, renderChatUserPrompt, resolveChatPrompt, CHAT_PROMPT_KEY } from "@/server/ai/prompts/defaults";
import { db } from "@/server/db";
import { conversations, messages, notebooks, userSettings, type MessageScope } from "@/server/db/schema";
import { resolveChatConnections, retrieveFromConnections, type ConnectionRetrieval } from "@/server/connectors/connections";
import { retrieve } from "@/server/knowledge/retrieve";
import { localKnowledgeProvider } from "@/server/knowledge/providers/local";
import { webKnowledgeProvider } from "@/server/knowledge/providers/web";
import type { Evidence, KnowledgeProvider } from "@/server/knowledge/providers/types";
import { listReadySourceIds } from "@/server/knowledge/sources";
import { NOT_FOUND_SENTINEL, stripCitations } from "@/lib/citations";
import type { AskResult, AskStreamEvent, ChatScope, ChatUsage, ScopeAdjustReason } from "@/lib/chat";
import {
  deleteSupersededAnswer,
  getConversationOrThrow,
  listMessages,
  listRecentMessages,
  titleFromQuestion,
  toMessageDto,
  type Message,
} from "./conversations";

/** 60 câu hỏi / 10 phút / người dùng (docs/02 §5). */
export const ASK_RATE_LIMIT = { limit: 60, windowMs: 10 * 60 * 1000 } as const;
/** Số lượt (hỏi + đáp) gần nhất đưa vào lịch sử cho mô hình. */
export const HISTORY_TURNS = 10;
const HISTORY_MAX_CHARS = 16_000;
const LOCAL_TOP_K = 12;
/** Câu hỏi quá ngắn (vd. "còn cái thứ hai?") được ghép với câu hỏi trước để truy hồi tốt hơn. */
const SHORT_QUESTION_WORDS = 3;

export const NO_EVIDENCE_ANSWER = `${NOT_FOUND_SENTINEL}. Hãy kiểm tra các nguồn đang được chọn (cần ít nhất một nguồn ở trạng thái "sẵn sàng"), thêm nguồn mới hoặc đặt lại câu hỏi cụ thể hơn.`;

export type AskDeps = {
  getProvider?: (userId: string) => Promise<AiProvider>;
  local?: KnowledgeProvider;
  web?: KnowledgeProvider;
};

export type AskParams = {
  userId: string;
  notebookId: string;
  conversationId: string;
  question: string;
  scope?: ChatScope;
  model?: string;
  regenerate?: boolean;
};

export type PreparedAsk = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  evidence: Evidence[];
  scope: ChatScope;
  adjustments: ScopeAdjustReason[];
  /** Chi tiết cho `connection_error`: nhãn kết nối + lỗi thật (mỗi kết nối lỗi một dòng). */
  adjustmentDetails: string[];
  /** Sinh sự kiện SSE; hủy bằng `signal` thì lưu phần trả lời đã có (nếu có). */
  run(signal?: AbortSignal): AsyncGenerator<AskStreamEvent>;
};

function errorEvent(err: unknown): AskStreamEvent {
  const e = err as { name?: string; message?: string } | null;
  if (e?.name === "AiProviderError") return { type: "error", code: "ai_provider_error", message: e.message ?? "Lỗi từ nhà cung cấp AI" };
  if (e?.name === "AiNotConfiguredError") return { type: "error", code: "ai_not_configured", message: e.message ?? "Chưa cấu hình AI" };
  if (err instanceof ApiError) return { type: "error", code: err.code, message: err.message };
  console.error("[chat] ask failed", err);
  return { type: "error", code: "internal_error", message: "Đã xảy ra lỗi máy chủ" };
}

function toChatUsage(u: Usage | undefined): ChatUsage | null {
  return u ? { inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens } : null;
}

/** Lịch sử gửi cho mô hình: bỏ `[n]` của lượt cũ (đánh số mỗi lượt khác nhau), cắt theo số lượt và độ dài. */
function buildHistory(prior: Message[]): ChatMsg[] {
  const turns = prior.filter((m) => m.role === "user" || m.role === "assistant").slice(-HISTORY_TURNS * 2);
  const out: ChatMsg[] = turns.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.role === "assistant" ? stripCitations(m.content) : m.content,
  }));
  let total = out.reduce((n, m) => n + m.content.length, 0);
  while (out.length > 0 && (total > HISTORY_MAX_CHARS || out[0].role !== "user")) {
    total -= out.shift()!.content.length;
  }
  return out;
}

function retrievalQuery(question: string, prior: Message[]): string {
  const words = question.trim().split(/\s+/).length;
  if (words > SHORT_QUESTION_WORDS) return question;
  const lastUser = [...prior].reverse().find((m) => m.role === "user");
  return lastUser ? `${lastUser.content} ${question}`.slice(0, 2000) : question;
}

export function buildUserTurn(contextText: string, userPrompt: string): string {
  const sources = contextText.trim() || "(Không có đoạn nguồn nào phù hợp với câu hỏi.)";
  return `NGUỒN (chỉ được trích dẫn các số [n] dưới đây):\n${sources}\n\nCÂU HỎI:\n${userPrompt}`;
}

/**
 * Chuẩn bị một lượt hỏi đáp: kiểm tra hội thoại, giới hạn tần suất, chốt phạm vi, lưu tin nhắn người dùng,
 * truy hồi bằng chứng và dựng prompt. Lỗi (404/412/429/…) được ném TRƯỚC khi bắt đầu stream.
 * Dùng lại được cho Studio (`askQuestion`) hoặc route SSE.
 */
export async function prepareAsk(params: AskParams, deps: AskDeps = {}): Promise<PreparedAsk> {
  const { userId, notebookId } = params;
  const conversation = await getConversationOrThrow(userId, notebookId, params.conversationId);
  const [notebook] = await db
    .select({ allowWeb: notebooks.allowWeb, systemInstruction: notebooks.systemInstruction })
    .from(notebooks)
    .where(eq(notebooks.id, notebookId))
    .limit(1);
  if (!notebook) throw ApiError.notFound("Không tìm thấy sổ tay");

  const provider = await (deps.getProvider ?? getAiProviderForUser)(userId);
  await enforceRateLimit(
    `ask:${userId}`,
    ASK_RATE_LIMIT.limit,
    ASK_RATE_LIMIT.windowMs,
    "Bạn đặt câu hỏi quá nhanh (tối đa 60 câu mỗi 10 phút). Vui lòng thử lại sau khoảng {minutes} phút.",
  );

  const all = await listRecentMessages(conversation.id);
  let question = params.question;
  let userMessage: Message | undefined;
  let supersededId: string | null = null;
  let prior = all;
  if (params.regenerate) {
    const last = all[all.length - 1];
    const lastUserIdx = all.map((m) => m.role).lastIndexOf("user");
    if (!last || lastUserIdx < 0) throw ApiError.badRequest("Chưa có câu hỏi nào để tạo lại câu trả lời");
    userMessage = all[lastUserIdx];
    question = userMessage.content;
    if (last.role === "assistant") supersededId = last.id;
    prior = all.slice(0, lastUserIdx);
  }

  // Phạm vi
  const adjustments: ScopeAdjustReason[] = [];
  const requested = params.scope ?? {};
  const readyIds = await listReadySourceIds(notebookId, userId);
  const readySet = new Set(readyIds);
  const sourceIds = requested.sourceIds ? [...new Set(requested.sourceIds)].filter((id) => readySet.has(id)) : readyIds;
  let useWeb = Boolean(requested.useWeb);
  if (useWeb && !notebook.allowWeb) {
    useWeb = false;
    adjustments.push("web_not_allowed");
  }
  // Kết nối ngoài: chỉ dùng kết nối của chính mình hoặc đã chia sẻ cho thành viên (403 nếu không); Enterprise không có chat.
  const chatConnections = requested.connectionIds?.length
    ? await resolveChatConnections({ notebookId, userId, connectionIds: requested.connectionIds })
    : { providers: [], skipped: 0 };
  if (requested.connectionIds?.length && chatConnections.providers.length === 0) adjustments.push("connections_unavailable");
  const scope: ChatScope = {
    sourceIds,
    useWeb,
    ...(chatConnections.providers.length > 0 ? { connectionIds: chatConnections.providers.map((p) => p.connectionId) } : {}),
  };

  // Bằng chứng: kho cục bộ + kết nối ngoài + web. Truy hồi TRƯỚC khi lưu câu hỏi để lỗi kết nối không để lại tin nhắn mồ côi.
  const rq = { query: retrievalQuery(question, prior), notebookId, userId };
  const local = deps.local ?? localKnowledgeProvider;
  const noConnections: ConnectionRetrieval = { evidence: [], errors: [] };
  const [localEvidence, connectionResult, webEvidence] = await Promise.all([
    sourceIds.length > 0 ? retrieve({ ...rq, sourceIds, topK: LOCAL_TOP_K }, [local]) : Promise.resolve([] as Evidence[]),
    chatConnections.providers.length > 0 ? retrieveFromConnections(chatConnections.providers, rq) : Promise.resolve(noConnections),
    useWeb
      ? (deps.web ?? webKnowledgeProvider).retrieve({ ...rq, topK: 6 }).catch((err: unknown) => {
          console.error("[chat] web retrieval failed", err);
          return [] as Evidence[];
        })
      : Promise.resolve([] as Evidence[]),
  ]);
  const adjustmentDetails = connectionResult.errors.map((e) => `${e.label}: ${e.message}`);
  if (adjustmentDetails.length > 0) adjustments.push("connection_error");
  if (connectionResult.errors.length > 0 && localEvidence.length + connectionResult.evidence.length + webEvidence.length === 0) {
    // Không có gì để trả lời và nguyên nhân là kết nối lỗi: báo lỗi thật thay vì "không tìm thấy trong nguồn".
    throw new ApiError(502, "connector_error", adjustmentDetails.join("; "));
  }
  // Bằng chứng kết nối được nối SAU kho cục bộ; đánh số [n] liên tục.
  const { evidence, contextText } = buildContext([...localEvidence, ...connectionResult.evidence, ...webEvidence]);

  if (!userMessage) {
    [userMessage] = await db
      .insert(messages)
      .values({ conversationId: conversation.id, role: "user", content: question, scope: scope as MessageScope })
      .returning();
  }
  await db
    .update(conversations)
    .set({ ...(conversation.title ? {} : { title: titleFromQuestion(question) }), updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id));

  // Prompt
  const [settings] = await db.select({ prompts: userSettings.prompts }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const chatPrompt = resolveChatPrompt(settings?.prompts?.[CHAT_PROMPT_KEY]);
  const system = composeChatSystem(chatPrompt.system, notebook.systemInstruction);
  const chatMessages: ChatMsg[] = [
    ...buildHistory(prior),
    { role: "user", content: buildUserTurn(contextText, renderChatUserPrompt(chatPrompt.user, question)) },
  ];
  const modelLabel = provider.id === "mock" ? "mock-chat" : (params.model ?? (await getUserModels(userId)).chat);

  const assistantMessageId = randomUUID();
  const userMessageId = userMessage.id;
  const finalScope = scope;

  async function* run(signal?: AbortSignal): AsyncGenerator<AskStreamEvent> {
    for (const reason of adjustments) {
      if (reason === "connection_error") {
        for (const detail of adjustmentDetails) yield { type: "scope_adjusted", reason, scope: finalScope, detail };
      } else {
        yield { type: "scope_adjusted", reason, scope: finalScope };
      }
    }
    yield { type: "meta", messageId: assistantMessageId, userMessageId, evidence, scope: finalScope };

    let raw = "";
    let usage: Usage | undefined;
    let aborted = false;
    if (evidence.length === 0) {
      // Không có bằng chứng: trả lời cố định, không tốn lượt gọi mô hình.
      raw = NO_EVIDENCE_ANSWER;
      yield { type: "delta", text: raw };
    } else {
      try {
        for await (const chunk of provider.streamText({
          model: params.model,
          system,
          messages: chatMessages,
          temperature: 0.3,
        })) {
          if (signal?.aborted) {
            aborted = true;
            break;
          }
          if (chunk.delta) {
            raw += chunk.delta;
            yield { type: "delta", text: chunk.delta };
          }
          if (chunk.usage) usage = chunk.usage;
        }
      } catch (err) {
        yield errorEvent(err);
        return;
      }
    }
    if (!raw.trim()) {
      if (aborted) return;
      raw = NO_EVIDENCE_ANSWER;
      yield { type: "delta", text: raw };
    }

    const checked = postCheckAnswer(raw, evidence);
    const chatUsage = toChatUsage(usage);
    const [saved] = await db
      .insert(messages)
      .values({
        id: assistantMessageId,
        conversationId: conversation.id,
        role: "assistant",
        content: checked.content,
        citations: checked.citations,
        sourcesUsed: checked.sourcesUsed,
        insufficientEvidence: checked.insufficientEvidence,
        insufficientReason: checked.insufficientReason,
        scope: finalScope as MessageScope,
        model: modelLabel,
        usage: chatUsage as Record<string, unknown> | null,
      })
      .returning();
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
    if (supersededId) await deleteSupersededAnswer(supersededId);
    if (aborted) return;
    yield {
      type: "done",
      messageId: saved.id,
      content: saved.content,
      citations: checked.citations,
      sourcesUsed: checked.sourcesUsed,
      insufficientEvidence: checked.insufficientEvidence,
      insufficientReason: checked.insufficientReason,
      usage: chatUsage,
      model: saved.model,
    };
  }

  return {
    conversationId: conversation.id,
    userMessageId,
    assistantMessageId,
    evidence,
    scope: finalScope,
    adjustments,
    adjustmentDetails,
    run,
  };
}

/** Chạy trọn vẹn một lượt hỏi đáp (không stream). Lỗi mô hình được ném lại như lỗi thường. */
export async function askQuestion(params: AskParams, deps: AskDeps = {}): Promise<AskResult> {
  const prepared = await prepareAsk(params, deps);
  let done: Extract<AskStreamEvent, { type: "done" }> | null = null;
  for await (const ev of prepared.run()) {
    if (ev.type === "error") {
      if (ev.code === "ai_provider_error") {
        throw new AiProviderError(ev.message);
      }
      throw new ApiError(500, ev.code, ev.message);
    }
    if (ev.type === "done") done = ev;
  }
  if (!done) throw new ApiError(500, "internal_error", "Không nhận được câu trả lời");
  const all = await listMessages(prepared.conversationId);
  const find = (id: string) => {
    const m = all.find((x) => x.id === id);
    if (!m) throw new ApiError(500, "internal_error", "Không đọc lại được tin nhắn");
    return toMessageDto(m);
  };
  return {
    userMessage: find(prepared.userMessageId),
    message: find(done.messageId),
    evidence: prepared.evidence,
    scope: prepared.scope,
    scopeAdjustments: prepared.adjustments,
    ...(prepared.adjustmentDetails.length > 0 ? { scopeAdjustmentDetails: prepared.adjustmentDetails } : {}),
  };
}
