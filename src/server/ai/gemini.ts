import "server-only";
import { GoogleGenAI, type Content, type GenerateContentConfig, type GenerateContentResponse } from "@google/genai";
import {
  AiProviderError,
  DEFAULT_MODELS,
  EMBEDDING_DIM,
  type AiProvider,
  type ChatMsg,
  type EmbedOptions,
  type StreamChunk,
  type TextRequest,
  type TextResult,
  type Usage,
  type WebSource,
} from "./provider";

export type GeminiOptions = {
  apiKey: string;
  chatModel?: string | null;
  embeddingModel?: string | null;
  imageModel?: string | null;
};

function toContents(messages: ChatMsg[]): { contents: Content[]; system: string[] } {
  const system: string[] = [];
  const contents: Content[] = [];
  for (const m of messages) {
    if (m.role === "system") system.push(m.content);
    else contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
  }
  return { contents, system };
}

function extractUsage(res: GenerateContentResponse): Usage | undefined {
  const u = res.usageMetadata;
  if (!u) return undefined;
  return {
    inputTokens: u.promptTokenCount,
    outputTokens: u.candidatesTokenCount,
    totalTokens: u.totalTokenCount,
  };
}

function extractWebSources(res: GenerateContentResponse): WebSource[] {
  const gm = res.candidates?.[0]?.groundingMetadata;
  const out: WebSource[] = [];
  for (const chunk of gm?.groundingChunks ?? []) {
    if (chunk.web?.uri) out.push({ url: chunk.web.uri, title: chunk.web.title ?? chunk.web.uri });
  }
  return out;
}

function dedupeSources(list: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  return list.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
}

function wrapError(err: unknown): AiProviderError {
  if (err instanceof AiProviderError) return err;
  const e = err as { status?: number; message?: string };
  let message = e?.message ?? "Lỗi không xác định từ Gemini";
  // Lỗi SDK thường là JSON dạng {"error":{"message":...}}
  try {
    const parsed = JSON.parse(message) as { error?: { message?: string } };
    if (parsed?.error?.message) message = parsed.error.message;
  } catch {
    /* giữ nguyên */
  }
  return new AiProviderError(message, typeof e?.status === "number" ? e.status : null);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status !== 429 && status !== 503 && status !== 500) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw wrapError(lastErr);
}

function l2normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1]);
    throw new AiProviderError("Model không trả về JSON hợp lệ");
  }
}

export class GeminiProvider implements AiProvider {
  readonly id = "gemini" as const;
  private readonly client: GoogleGenAI;
  private readonly chatModel: string;
  private readonly embeddingModel: string;
  private readonly imageModel: string;

  constructor(opts: GeminiOptions) {
    this.client = new GoogleGenAI({ apiKey: opts.apiKey });
    this.chatModel = opts.chatModel || DEFAULT_MODELS.chat;
    this.embeddingModel = opts.embeddingModel || DEFAULT_MODELS.embedding;
    this.imageModel = opts.imageModel || DEFAULT_MODELS.image;
  }

  private buildConfig(req: TextRequest, system: string[]): GenerateContentConfig {
    const systemInstruction = [req.system, ...system].filter(Boolean).join("\n\n");
    const config: GenerateContentConfig = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (req.temperature !== undefined) config.temperature = req.temperature;
    if (req.jsonSchema) {
      config.responseMimeType = "application/json";
      config.responseJsonSchema = req.jsonSchema;
    }
    if (req.tools?.googleSearch) config.tools = [{ googleSearch: {} }];
    return config;
  }

  async generateText(req: TextRequest): Promise<TextResult> {
    const { contents, system } = toContents(req.messages);
    const res = await withRetry(() =>
      this.client.models.generateContent({
        model: req.model || this.chatModel,
        contents,
        config: this.buildConfig(req, system),
      }),
    );
    const text = res.text ?? "";
    const result: TextResult = { text, usage: extractUsage(res) };
    if (req.jsonSchema) result.json = parseJsonLoose(text);
    const web = extractWebSources(res);
    if (web.length) result.webSources = dedupeSources(web);
    return result;
  }

  async *streamText(req: TextRequest): AsyncIterable<StreamChunk> {
    const { contents, system } = toContents(req.messages);
    let stream: AsyncGenerator<GenerateContentResponse>;
    try {
      stream = await this.client.models.generateContentStream({
        model: req.model || this.chatModel,
        contents,
        config: this.buildConfig(req, system),
      });
    } catch (err) {
      throw wrapError(err);
    }
    const web: WebSource[] = [];
    let usage: Usage | undefined;
    try {
      for await (const chunk of stream) {
        const delta = chunk.text;
        if (delta) yield { delta };
        web.push(...extractWebSources(chunk));
        usage = extractUsage(chunk) ?? usage;
      }
    } catch (err) {
      throw wrapError(err);
    }
    yield { done: true, webSources: web.length ? dedupeSources(web) : undefined, usage };
  }

  async embed(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
    if (texts.length === 0) return [];
    const dim = opts.dim ?? EMBEDDING_DIM;
    const out: number[][] = [];
    const BATCH = 100;
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      const res = await withRetry(() =>
        this.client.models.embedContent({
          model: this.embeddingModel,
          contents: batch,
          config: { outputDimensionality: dim, taskType: opts.taskType ?? "RETRIEVAL_DOCUMENT" },
        }),
      );
      const embeddings = res.embeddings ?? [];
      if (embeddings.length !== batch.length) {
        throw new AiProviderError("Số vector embedding trả về không khớp với số đoạn văn bản");
      }
      for (const e of embeddings) out.push(l2normalize(e.values ?? []));
    }
    return out;
  }

  async generateImage(prompt: string, opts: { aspect?: string } = {}): Promise<{ bytes: Buffer; mime: string }> {
    const res = await withRetry(() =>
      this.client.models.generateContent({
        model: this.imageModel,
        contents: prompt,
        config: {
          responseModalities: ["IMAGE", "TEXT"],
          ...(opts.aspect ? { imageConfig: { aspectRatio: opts.aspect } } : {}),
        },
      }),
    );
    for (const part of res.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return {
          bytes: Buffer.from(part.inlineData.data, "base64"),
          mime: part.inlineData.mimeType ?? "image/png",
        };
      }
    }
    throw new AiProviderError("Model không trả về ảnh");
  }

  async listModels(): Promise<string[]> {
    try {
      const pager = await this.client.models.list({ config: { pageSize: 100 } });
      const names: string[] = [];
      for await (const m of pager) {
        if (m.name) names.push(m.name.replace(/^models\//, ""));
      }
      return names.sort();
    } catch (err) {
      throw wrapError(err);
    }
  }
}
