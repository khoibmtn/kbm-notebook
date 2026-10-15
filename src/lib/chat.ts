/**
 * Kiểu dùng chung client + server cho Chat AI (DTO, sự kiện SSE).
 */
import type { Evidence } from "@/server/knowledge/providers/types";

export type { Evidence };

export type ChatScope = { sourceIds?: string[]; connectionIds?: string[]; useWeb?: boolean };

/** Một nguồn thực sự được trích dẫn trong câu trả lời (khử trùng theo nguồn). */
export type SourceUsed = {
  /** Khoá ổn định để render danh sách. */
  key: string;
  sourceId: string | null;
  provider: Evidence["provider"];
  title: string;
  url?: string;
  /** Mô tả vị trí đã dựng sẵn (vd. "trang 3", "mục \"Giới thiệu\""), mỗi đoạn được trích một mục. */
  locators: string[];
  /** Các số `[n]` thuộc nguồn này. */
  numbers: number[];
};

export type ChatUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

export type ConversationDto = {
  id: string;
  notebookId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InsufficientReasonDto = "no_evidence" | "not_found" | "low_similarity" | "no_citations";

export type ChatMessageDto = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Evidence[] | null;
  sourcesUsed: SourceUsed[] | null;
  insufficientEvidence: boolean;
  /** Lý do cảnh báo thiếu bằng chứng (null nếu đủ). */
  insufficientReason: InsufficientReasonDto | null;
  scope: ChatScope | null;
  model: string | null;
  usage: ChatUsage | null;
  createdAt: string;
};

/**
 * `connections_unavailable`: không có kết nối nào dùng được cho hỏi đáp (vd. chỉ chọn NotebookLM Enterprise — không có chat API).
 * `connection_error`: một kết nối ngoài lỗi khi truy vấn (kèm `detail`); câu trả lời dùng các kho còn lại.
 */
export type ScopeAdjustReason = "web_not_allowed" | "connections_unavailable" | "connection_error";

/** Sự kiện SSE của `POST …/conversations/[id]/messages`. */
export type AskStreamEvent =
  | { type: "meta"; messageId: string; userMessageId: string; evidence: Evidence[]; scope: ChatScope }
  | { type: "scope_adjusted"; reason: ScopeAdjustReason; scope: ChatScope; detail?: string }
  | { type: "delta"; text: string }
  | {
      type: "done";
      messageId: string;
      content: string;
      citations: Evidence[];
      sourcesUsed: SourceUsed[];
      insufficientEvidence: boolean;
      insufficientReason: InsufficientReasonDto | null;
      usage: ChatUsage | null;
      model: string | null;
    }
  | { type: "error"; code: string; message: string };

/** Kết quả JSON của `?stream=0`. */
export type AskResult = {
  userMessage: ChatMessageDto;
  message: ChatMessageDto;
  evidence: Evidence[];
  scope: ChatScope;
  scopeAdjustments: ScopeAdjustReason[];
  /** Mô tả chi tiết cho `connection_error` (nhãn kết nối + lỗi thật từ bridge). */
  scopeAdjustmentDetails?: string[];
};

/** Ngưỡng cosine (0–1): bằng chứng tốt nhất thấp hơn mức này → coi là thiếu bằng chứng. */
export const INSUFFICIENT_SIMILARITY_THRESHOLD = 0.25;
