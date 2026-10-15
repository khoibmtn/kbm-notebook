import "server-only";
import { CitationRemapper } from "@/lib/artifacts/citations";
import type { MarkdownArtifactType, MarkdownContent } from "@/lib/artifacts/content";
import { CITATION_RULES } from "../prompt";
import { docOutputSchema } from "../schemas";
import { generateJson, withContextBlock, type GeneratedArtifact, type GeneratorInput } from "./common";

const FORMAT_RULES = `Định dạng đầu ra: JSON {"title": string, "markdown": string}.
- "markdown": Markdown chuẩn (tiêu đề #/##, danh sách, bảng, in đậm/nghiêng khi cần). Không bọc trong khối code.
- Chèn trích dẫn dạng [n] ngay sau ý có căn cứ, ví dụ "Doanh thu tăng 12% [2]."`;

/** note / report / study_guide / faq / timeline: model sinh Markdown; hậu kiểm [n] rồi đánh số lại gọn. */
export async function generateMarkdownDoc(type: MarkdownArtifactType, input: GeneratorInput): Promise<GeneratedArtifact> {
  const out = await generateJson(input, {
    type,
    schema: docOutputSchema,
    system: `${CITATION_RULES}\n${FORMAT_RULES}`,
    user: withContextBlock(input.instructions, input.contextText),
    temperature: 0.5,
  });
  const remap = new CitationRemapper(input.evidence);
  const markdown = remap.markdown(out.markdown.trim());
  const content: MarkdownContent = { markdown, evidence: remap.used };
  return { content, title: out.title.trim() || undefined };
}
