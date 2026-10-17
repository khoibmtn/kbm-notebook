import "server-only";

export type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

export type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

export type WebSource = { url: string; title: string; snippet?: string };

export type TextRequest = {
  model?: string;
  system?: string;
  messages: ChatMsg[];
  temperature?: number;
  /** JSON Schema (draft-07 subset) → bắt model trả JSON hợp lệ; kết quả nằm ở `json`. */
  jsonSchema?: object;
  tools?: { googleSearch?: boolean };
  /** Chỉ dùng cho MockAiProvider: JSON trả về khi có jsonSchema. */
  __mockJson?: unknown;
  /** Chỉ dùng cho MockAiProvider: khoá để tra JSON đã đăng ký (`registerMockJson`), vd `artifact:quiz`. */
  __mockKey?: string;
};

export type TextResult = { text: string; json?: unknown; usage?: Usage; webSources?: WebSource[] };

export type StreamChunk = { delta?: string; done?: boolean; webSources?: WebSource[]; usage?: Usage };

export type EmbedOptions = { dim?: number; taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" };

/** Contract AI cho mọi module (docs/02 §3.1). */
export interface AiProvider {
  id: "gemini" | "mock";
  generateText(req: TextRequest): Promise<TextResult>;
  streamText(req: TextRequest): AsyncIterable<StreamChunk>;
  embed(texts: string[], opts?: EmbedOptions): Promise<number[][]>;
  generateImage?(prompt: string, opts?: { aspect?: string }): Promise<{ bytes: Buffer; mime: string }>;
  listModels?(): Promise<string[]>;
}

/** Chưa có key người dùng lẫn key server → HTTP 412 (UI hiển thị hướng dẫn cấu hình). */
export class AiNotConfiguredError extends Error {
  constructor(message = "Chưa cấu hình khoá Gemini API. Hãy thêm khoá trong Cài đặt → AI.") {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}

/** Lỗi trả về từ nhà cung cấp AI (key sai, hết quota, model không tồn tại...). */
export class AiProviderError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "AiProviderError";
    this.status = status;
  }
}

/** Model mặc định (có thể ghi đè bằng biến môi trường hoặc user_settings). */
export const DEFAULT_MODELS = {
  chat: process.env.GEMINI_CHAT_MODEL || "gemini-flash-latest",
  artifact: process.env.GEMINI_ARTIFACT_MODEL || "gemini-pro-latest",
  embedding: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
  image: process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image",
} as const;

export const EMBEDDING_DIM = 768;
