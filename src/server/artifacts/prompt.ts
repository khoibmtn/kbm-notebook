import "server-only";
import type { PromptOverride } from "@/server/db/schema";
import { resolvePrompt, type ArtifactType } from "@/server/ai/prompts/defaults";
import type { ArtifactOptions } from "@/lib/artifacts/meta";

export const DEFAULT_LANGUAGE = "Tiếng Việt";

const LENGTH_LABEL: Record<NonNullable<ArtifactOptions["length"]>, string> = {
  short: "ngắn (khoảng 300–500 từ)",
  medium: "vừa (khoảng 800–1200 từ)",
  long: "dài, chi tiết (khoảng 1800–2500 từ hoặc hơn nếu nguồn có nhiều nội dung)",
};
const DIFFICULTY_LABEL = { easy: "dễ", medium: "trung bình", hard: "khó" } as const;
const QTYPE_LABEL = { mcq: "trắc nghiệm một đáp án (mcq)", tf: "đúng/sai (tf)", short: "trả lời ngắn (short)" } as const;
const FORMAT_LABEL: Record<NonNullable<ArtifactOptions["format"]>, string> = {
  briefing: "Tài liệu tóm lược (briefing): tóm tắt điều hành, các phát hiện chính, kết luận và đề xuất",
  study_guide: "Hướng dẫn học tập: mục tiêu, khái niệm chính, ví dụ, câu hỏi tự kiểm tra, bảng thuật ngữ",
  faq: "Bộ câu hỏi thường gặp (FAQ) nhóm theo chủ đề",
  timeline: "Dòng thời gian theo thứ tự thời gian, mỗi mục có mốc thời gian, sự kiện và ý nghĩa",
};

/** Biến tuỳ chọn thành các dòng chỉ dẫn tiếng Việt cho model. Khoá lạ được in nguyên dạng `khoá: giá trị`. */
export function optionDirectives(type: ArtifactType, options: Record<string, unknown>): string[] {
  const o = options as ArtifactOptions & Record<string, unknown>;
  const lines: string[] = [];
  const language = typeof o.language === "string" && o.language.trim() ? o.language.trim() : DEFAULT_LANGUAGE;
  lines.push(`Ngôn ngữ đầu ra: ${language}`);
  const known = new Set(["language"]);
  const take = (key: string) => {
    known.add(key);
    return o[key];
  };

  const length = take("length");
  if (typeof length === "string") lines.push(`Độ dài: ${LENGTH_LABEL[length as keyof typeof LENGTH_LABEL] ?? length}`);
  const format = take("format");
  if (typeof format === "string" && type === "report") lines.push(`Kiểu tài liệu: ${FORMAT_LABEL[format as keyof typeof FORMAT_LABEL] ?? format}`);
  const count = take("count");
  if (typeof count === "number") {
    const what = type === "quiz" ? "câu hỏi" : type === "flashcards" ? "thẻ" : type === "faq" ? "cặp hỏi-đáp" : "mục";
    lines.push(`Số lượng: đúng ${count} ${what} (ít hơn chỉ khi nguồn không đủ nội dung)`);
  }
  const difficulty = take("difficulty");
  if (typeof difficulty === "string") lines.push(`Độ khó: ${DIFFICULTY_LABEL[difficulty as keyof typeof DIFFICULTY_LABEL] ?? difficulty}`);
  const qtypes = take("questionTypes");
  if (Array.isArray(qtypes) && qtypes.length) {
    lines.push(`Loại câu hỏi được dùng: ${qtypes.map((q) => QTYPE_LABEL[q as keyof typeof QTYPE_LABEL] ?? String(q)).join(", ")}`);
  }
  const depth = take("depth");
  if (typeof depth === "number") lines.push(`Độ sâu sơ đồ: tối đa ${depth} cấp (không tính nút gốc)`);
  const cols = take("columnsHint");
  if (typeof cols === "string" && cols.trim()) lines.push(`Các cột mong muốn: ${cols.trim()}`);
  const slideCount = take("slideCount");
  if (slideCount === "auto") lines.push("Số slide: tự chọn phù hợp với nội dung");
  else if (typeof slideCount === "number") lines.push(`Số slide: ${slideCount}`);
  const style = take("style");
  if (typeof style === "string") lines.push(`Phong cách: ${style === "concise" ? "súc tích" : style === "detailed" ? "chi tiết" : style}`);
  const audience = take("audience");
  if (typeof audience === "string" && audience.trim()) lines.push(`Đối tượng: ${audience.trim()}`);
  const images = take("includeImages");
  if (typeof images === "boolean") lines.push(`Hình ảnh minh hoạ: ${images ? "có" : "không"}`);
  const orientation = take("orientation");
  if (typeof orientation === "string") lines.push(`Hướng: ${orientation === "landscape" ? "ngang" : orientation === "portrait" ? "dọc" : orientation}`);
  const detail = take("detailLevel");
  if (typeof detail === "string") lines.push(`Mức chi tiết: ${detail === "low" ? "thấp" : detail === "high" ? "cao" : "vừa"}`);

  // Tuỳ chọn lạ do người dùng tự thêm trong Cài đặt → Prompt
  for (const [k, v] of Object.entries(o)) {
    if (known.has(k) || v === undefined || v === null || v === "") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") lines.push(`${k}: ${v}`);
  }
  return lines;
}

export type ComposedPrompt = {
  system: string;
  /** Phần yêu cầu (chưa gồm ngữ cảnh nguồn). */
  user: string;
  /** Tuỳ chọn hiệu lực đã gộp (mặc định ⊕ ghi đè người dùng ⊕ tuỳ chọn lần tạo). */
  options: Record<string, unknown>;
  language: string;
};

/**
 * Prompt = mặc định trong code (`defaults.ts`) ⊕ ghi đè trong `user_settings.prompts[type]`
 * ⊕ prompt riêng ở hộp "Tuỳ chỉnh" ⊕ tuỳ chọn (ngôn ngữ mặc định tiếng Việt, độ dài, độ khó, số lượng…).
 * Placeholder `{{instructions}}` ← prompt riêng; `{{options}}` ← danh sách chỉ dẫn từ tuỳ chọn
 * (nếu mẫu không có `{{options}}` thì chỉ dẫn được nối vào cuối).
 */
export function composePrompt(input: {
  type: ArtifactType;
  override?: PromptOverride | null;
  customPrompt?: string | null;
  options?: Record<string, unknown>;
}): ComposedPrompt {
  const template = resolvePrompt(input.type, input.override);
  const options: Record<string, unknown> = { ...template.options };
  // Tuỳ chọn mặc định trong code có thể dùng khoá cũ (vd `slides`, `length: "vừa"`); lần tạo cụ thể ghi đè.
  for (const [k, v] of Object.entries(input.options ?? {})) if (v !== undefined) options[k] = v;
  if (typeof options.slides === "number" && options.slideCount === undefined) options.slideCount = options.slides;
  delete options.slides;

  const directives = optionDirectives(input.type, options);
  const optionsBlock = directives.map((d) => `- ${d}`).join("\n");
  const custom = input.customPrompt?.trim() ?? "";
  const customBlock = custom ? `Yêu cầu riêng của người dùng (ưu tiên làm theo):\n${custom}` : "";

  let user = template.user;
  const hasOptionsSlot = user.includes("{{options}}");
  user = user.replace("{{instructions}}", customBlock);
  user = user.replace("{{options}}", optionsBlock);
  if (!hasOptionsSlot) user = `${user.trim()}\n\nTuỳ chọn:\n${optionsBlock}`;

  const language = typeof options.language === "string" && options.language.trim() ? options.language.trim() : DEFAULT_LANGUAGE;
  return { system: template.system, user: user.trim(), options, language };
}

/** Quy tắc trích dẫn thêm vào system của mọi generator. */
export const CITATION_RULES = `Quy tắc trích dẫn:
- Các nguồn được đánh số [1], [2]… ở phần "NGUỒN". Chỉ dùng số có trong danh sách đó.
- Mọi khẳng định có căn cứ phải gắn số nguồn tương ứng; không bịa nguồn, số liệu hay trích dẫn.
- Nếu nguồn không đủ thông tin cho phần nào đó, bỏ qua hoặc nói rõ "Không tìm thấy trong nguồn".`;

/** Ghép khối ngữ cảnh vào cuối yêu cầu. */
export function withContext(user: string, contextText: string): string {
  return `${user}\n\nNGUỒN:\n${contextText}`;
}
