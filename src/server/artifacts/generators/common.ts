import "server-only";
import type { z } from "zod";
import type { AiProvider } from "@/server/ai/provider";
import type { ArtifactEvidence, ArtifactTypeName } from "@/lib/artifacts/content";
import { toJsonSchema } from "../schemas";

/** Đầu vào chung của mọi generator (engine slide/infographic dùng cùng dạng). */
export type GeneratorInput = {
  /** Văn bản ngữ cảnh đã đánh số `[1..n]` (`buildContext`). */
  contextText: string;
  /** Bằng chứng tương ứng; phần tử thứ i được trích dẫn là `[i+1]`. */
  evidence: ArtifactEvidence[];
  /** Yêu cầu đã ghép (mẫu mặc định ⊕ ghi đè ⊕ prompt riêng ⊕ tuỳ chọn). */
  instructions: string;
  options: Record<string, unknown>;
  provider: AiProvider;
  model?: string;
  /** Chỉ dẫn hệ thống của loại (mặc định hoặc đã ghi đè). */
  system?: string;
};

export type GeneratedArtifact = {
  content: unknown;
  /** Tiêu đề model đề xuất (dùng nếu người dùng chưa đặt tên). */
  title?: string;
};

/** Model trả dữ liệu sai schema / không dùng được. Lỗi tạm thời → worker có thể thử lại. */
export class ArtifactGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactGenerationError";
  }
}

/**
 * Gọi model với JSON schema, kiểm bằng zod. Sai schema → thử lại một lần kèm mô tả lỗi;
 * vẫn sai → ném lỗi (không bịa nội dung).
 */
export async function generateJson<S extends z.ZodType>(
  input: GeneratorInput,
  opts: {
    type: ArtifactTypeName;
    schema: S;
    system: string;
    user: string;
    temperature?: number;
  },
): Promise<z.infer<S>> {
  const jsonSchema = toJsonSchema(opts.schema);
  const system = [input.system, opts.system].filter(Boolean).join("\n\n");
  let user = opts.user;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await input.provider.generateText({
      model: input.model,
      system,
      messages: [{ role: "user", content: user }],
      temperature: opts.temperature ?? 0.4,
      jsonSchema,
      __mockKey: `artifact:${opts.type}`,
    });
    let raw: unknown = res.json;
    if (raw === undefined) {
      try {
        raw = JSON.parse(res.text);
      } catch {
        lastError = "Đầu ra không phải JSON hợp lệ";
        user = `${opts.user}\n\nLần trước bạn trả về JSON không hợp lệ. Hãy trả về đúng JSON theo schema.`;
        continue;
      }
    }
    const parsed = opts.schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    lastError = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    user = `${opts.user}\n\nLần trước đầu ra sai schema (${lastError}). Hãy sửa và trả về đúng JSON theo schema.`;
  }
  throw new ArtifactGenerationError(`Model trả về dữ liệu không hợp lệ cho "${opts.type}": ${lastError}`);
}

export function withContextBlock(instructions: string, contextText: string): string {
  return `${instructions}\n\nNGUỒN:\n${contextText}`;
}
