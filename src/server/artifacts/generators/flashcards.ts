import "server-only";
import { CitationRemapper } from "@/lib/artifacts/citations";
import { flashcardsContentSchema, newItemId, type Flashcard, type FlashcardsContent } from "@/lib/artifacts/content";
import { CITATION_RULES } from "../prompt";
import { flashcardsOutputSchema } from "../schemas";
import { ArtifactGenerationError, generateJson, withContextBlock, type GeneratedArtifact, type GeneratorInput } from "./common";

const FORMAT_RULES = `Định dạng đầu ra: JSON {"title", "cards": [{"front", "back", "hint"?, "tags"?, "citations"}]}.
- Mỗi thẻ một ý; mặt trước là câu hỏi/thuật ngữ, mặt sau là câu trả lời ngắn gọn.
- "citations": số nguồn [n] làm căn cứ.`;

export async function generateFlashcards(input: GeneratorInput): Promise<GeneratedArtifact> {
  const out = await generateJson(input, {
    type: "flashcards",
    schema: flashcardsOutputSchema,
    system: `${CITATION_RULES}\n${FORMAT_RULES}`,
    user: withContextBlock(input.instructions, input.contextText),
  });
  const requested = typeof input.options.count === "number" ? input.options.count : undefined;
  const usable = out.cards.filter((c) => c.front.trim() && c.back.trim());
  const picked = requested ? usable.slice(0, requested) : usable;
  if (picked.length === 0) throw new ArtifactGenerationError("Model không tạo được thẻ ghi nhớ hợp lệ nào");
  const remap = new CitationRemapper(input.evidence);
  const cards: Flashcard[] = picked.map((c) => {
    const tags = c.tags?.map((t) => t.trim()).filter(Boolean);
    return {
      id: newItemId("c"),
      front: remap.markdown(c.front.trim()),
      back: remap.markdown(c.back.trim()),
      ...(c.hint?.trim() ? { hint: remap.markdown(c.hint.trim()) } : {}),
      ...(tags?.length ? { tags } : {}),
      citations: remap.list(c.citations),
    };
  });
  const content: FlashcardsContent = flashcardsContentSchema.parse({ cards, evidence: remap.used });
  return { content, title: out.title.trim() || undefined };
}
