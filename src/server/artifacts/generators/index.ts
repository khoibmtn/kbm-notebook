import "server-only";
import { isMarkdownType, type ArtifactTypeName } from "@/lib/artifacts/content";
import { slideDeckEnvelopeSchema, infographicEnvelopeSchema } from "@/lib/artifacts/content";
import { getInfographicEngine, getSlideEngine } from "../registry";
import { generateDataTable } from "./data-table";
import { generateFlashcards } from "./flashcards";
import { generateMarkdownDoc } from "./markdown-doc";
import { generateMindmap } from "./mindmap";
import { generateQuiz } from "./quiz";
import type { GeneratedArtifact, GeneratorInput } from "./common";

export type { GeneratedArtifact, GeneratorInput } from "./common";
export { ArtifactGenerationError } from "./common";

/** Điều phối generator theo loại. slide_deck/infographic đi qua engine ở `registry.ts` (501 nếu chưa có). */
export async function runGenerator(type: ArtifactTypeName, input: GeneratorInput): Promise<GeneratedArtifact> {
  if (isMarkdownType(type)) return generateMarkdownDoc(type, input);
  switch (type) {
    case "quiz":
      return generateQuiz(input);
    case "flashcards":
      return generateFlashcards(input);
    case "mindmap":
      return generateMindmap(input);
    case "data_table":
      return generateDataTable(input);
    case "slide_deck": {
      const engine = getSlideEngine();
      const o = input.options;
      const content = await engine.generate({
        contextText: input.contextText,
        evidence: input.evidence,
        instructions: input.instructions,
        provider: input.provider,
        model: input.model,
        options: {
          slideCount: o.slideCount as number | "auto" | undefined,
          style: o.style as "detailed" | "concise" | undefined,
          language: typeof o.language === "string" ? o.language : undefined,
          audience: typeof o.audience === "string" ? o.audience : undefined,
          includeImages: typeof o.includeImages === "boolean" ? o.includeImages : undefined,
        },
      });
      return { content: slideDeckEnvelopeSchema.parse(content) };
    }
    case "infographic": {
      const engine = getInfographicEngine();
      const content = await engine.generate({
        contextText: input.contextText,
        evidence: input.evidence,
        instructions: input.instructions,
        options: input.options,
        provider: input.provider,
        model: input.model,
      });
      const parsed = infographicEnvelopeSchema.parse(content);
      return { content: parsed, title: parsed.title || undefined };
    }
    default:
      throw new Error(`Loại artifact không có generator: ${type satisfies never}`);
  }
}
