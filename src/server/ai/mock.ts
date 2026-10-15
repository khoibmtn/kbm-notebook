import "server-only";
import { createHash } from "node:crypto";
import {
  EMBEDDING_DIM,
  type AiProvider,
  type EmbedOptions,
  type StreamChunk,
  type TextRequest,
  type TextResult,
} from "./provider";

type JsonSchemaLike = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  items?: JsonSchemaLike;
  enum?: unknown[];
  anyOf?: JsonSchemaLike[];
  oneOf?: JsonSchemaLike[];
  minItems?: number;
};

/** Sinh object tối thiểu hợp lệ theo JSON Schema (dùng cho mock). */
export function minimalValueFor(schema: JsonSchemaLike | undefined): unknown {
  if (!schema) return null;
  if (schema.enum?.length) return schema.enum[0];
  const alt = schema.anyOf?.[0] ?? schema.oneOf?.[0];
  if (alt) return minimalValueFor(alt);
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  switch (type) {
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const key of schema.required ?? []) obj[key] = minimalValueFor(schema.properties?.[key]);
      return obj;
    }
    case "array":
      return Array.from({ length: schema.minItems ?? 0 }, () => minimalValueFor(schema.items));
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Embedding xác định: băm từng từ vào vector 768 chiều rồi chuẩn hoá L2 (văn bản giống nhau → cosine cao). */
export function hashEmbed(text: string, dim = EMBEDDING_DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) tokens.push("∅");
  for (const tok of tokens) {
    const h = createHash("sha256").update(tok).digest();
    const idx = h.readUInt32BE(0) % dim;
    const sign = h[4] & 1 ? 1 : -1;
    v[idx] += sign;
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

export class MockAiProvider implements AiProvider {
  readonly id = "mock" as const;

  private lastUser(req: TextRequest): string {
    for (let i = req.messages.length - 1; i >= 0; i--) {
      if (req.messages[i].role === "user") return req.messages[i].content;
    }
    return "";
  }

  async generateText(req: TextRequest): Promise<TextResult> {
    const q = this.lastUser(req).replace(/\s+/g, " ").trim().slice(0, 200);
    const usage = { inputTokens: Math.ceil(q.length / 4), outputTokens: 16, totalTokens: Math.ceil(q.length / 4) + 16 };
    if (req.jsonSchema) {
      const json = req.__mockJson !== undefined ? req.__mockJson : minimalValueFor(req.jsonSchema as JsonSchemaLike);
      return { text: JSON.stringify(json), json, usage };
    }
    return {
      text: `[mock] Đây là câu trả lời giả lập cho: ${q}`,
      usage,
      webSources: req.tools?.googleSearch ? [] : undefined,
    };
  }

  async *streamText(req: TextRequest): AsyncIterable<StreamChunk> {
    const { text, usage } = await this.generateText(req);
    const words = text.split(/(\s+)/);
    for (const w of words) if (w) yield { delta: w };
    yield { done: true, usage };
  }

  async embed(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
    return texts.map((t) => hashEmbed(t, opts.dim ?? EMBEDDING_DIM));
  }

  async listModels(): Promise<string[]> {
    return ["mock-chat", "mock-embedding"];
  }
}
