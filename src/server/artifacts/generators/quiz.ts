import "server-only";
import { CitationRemapper } from "@/lib/artifacts/citations";
import { newItemId, quizContentSchema, type QuizContent, type QuizQuestion } from "@/lib/artifacts/content";
import { CITATION_RULES } from "../prompt";
import { quizOutputSchema, type QuizOutput } from "../schemas";
import { ArtifactGenerationError, generateJson, withContextBlock, type GeneratedArtifact, type GeneratorInput } from "./common";

const FORMAT_RULES = `Định dạng đầu ra: JSON {"title", "questions": [...]}.
- mcq: "options" gồm 3–5 lựa chọn với key A, B, C, D…; "answer" là key của đáp án đúng.
- tf: không có "options"; "answer" là "true" hoặc "false".
- short: không có "options"; "answer" là đáp án mẫu ngắn.
- "explanation": giải thích ngắn; "citations": số nguồn [n] làm căn cứ cho câu hỏi.
- "difficulty": easy | medium | hard.`;

const LETTERS = "ABCDEFGH";

type Normalized = Omit<QuizQuestion, "id" | "citations">;

/** Chuẩn hoá một câu hỏi do model sinh; trả null nếu hỏng (đáp án không khớp lựa chọn…). */
export function normalizeQuizQuestion(q: QuizOutput["questions"][number]): Normalized | null {
  const stem = q.stem.trim();
  if (!stem) return null;
  const explanation = q.explanation.trim();
  if (q.type === "tf") {
    const a = q.answer.trim().toLowerCase();
    const answer = ["true", "đúng", "dung", "yes"].includes(a) ? "true" : ["false", "sai", "no"].includes(a) ? "false" : null;
    return answer ? { type: "tf", stem, answer, explanation, difficulty: q.difficulty } : null;
  }
  if (q.type === "short") {
    const answer = q.answer.trim();
    return answer ? { type: "short", stem, answer, explanation, difficulty: q.difficulty } : null;
  }
  const rawOptions = (q.options ?? []).filter((o) => o.text.trim()).slice(0, LETTERS.length);
  if (rawOptions.length < 2) return null;
  const options = rawOptions.map((o, i) => ({ key: LETTERS[i], text: o.text.trim() }));
  // Đáp án theo key gốc ("B", "B.", "(B)") hoặc theo nội dung lựa chọn.
  const ans = q.answer.trim();
  const keyMatch = ans.match(/^\(?([A-Za-z])[).:]?(\s|$)/)?.[1]?.toUpperCase();
  let idx = keyMatch ? rawOptions.findIndex((o) => o.key.trim().toUpperCase() === keyMatch) : -1;
  if (idx < 0) idx = rawOptions.findIndex((o) => o.text.trim().toLowerCase() === ans.toLowerCase());
  if (idx < 0) return null;
  return { type: "mcq", stem, options, answer: options[idx].key, explanation, difficulty: q.difficulty };
}

export async function generateQuiz(input: GeneratorInput): Promise<GeneratedArtifact> {
  const out = await generateJson(input, {
    type: "quiz",
    schema: quizOutputSchema,
    system: `${CITATION_RULES}\n${FORMAT_RULES}`,
    user: withContextBlock(input.instructions, input.contextText),
  });
  const kept: Array<{ q: Normalized; citations: number[] }> = [];
  for (const raw of out.questions) {
    const q = normalizeQuizQuestion(raw);
    if (q) kept.push({ q, citations: raw.citations }); // câu hỏng bị loại, không sửa bừa
  }
  const requested = typeof input.options.count === "number" ? input.options.count : undefined;
  const finalKept = requested ? kept.slice(0, requested) : kept;
  if (finalKept.length === 0) throw new ArtifactGenerationError("Model không tạo được câu hỏi hợp lệ nào");

  const remap = new CitationRemapper(input.evidence);
  const questions: QuizQuestion[] = finalKept.map(({ q, citations }) => ({
    ...q,
    id: newItemId("q"),
    citations: remap.list(citations),
  }));
  const content: QuizContent = quizContentSchema.parse({ questions, evidence: remap.used });
  return { content, title: out.title.trim() || undefined };
}
