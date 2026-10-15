import "server-only";
import { NOT_FOUND_SENTINEL } from "@/lib/citations";
import type { PromptOverride } from "@/server/db/schema";

export const ARTIFACT_TYPES = [
  "note",
  "report",
  "study_guide",
  "faq",
  "timeline",
  "mindmap",
  "slide_deck",
  "infographic",
  "quiz",
  "flashcards",
  "data_table",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export type PromptTemplate = {
  /** Chỉ dẫn hệ thống cho loại artifact. */
  system: string;
  /** Mẫu yêu cầu; hỗ trợ placeholder {{instructions}} (yêu cầu riêng của người dùng) và {{options}}. */
  user: string;
  /** Tuỳ chọn mặc định (ngôn ngữ, độ dài, số lượng...). */
  options: Record<string, string | number | boolean>;
};

const COMMON_RULES = `Quy tắc chung:
- Chỉ dùng thông tin có trong các nguồn được cung cấp; không bịa số liệu, tên, trích dẫn.
- Trả lời bằng tiếng Việt trừ khi người dùng yêu cầu ngôn ngữ khác.
- Gắn trích dẫn dạng [n] theo danh sách nguồn đã đánh số; không dùng số không tồn tại.
- Nếu nguồn không đủ thông tin, nói rõ "Không tìm thấy trong nguồn" thay vì suy đoán.`;

export const DEFAULT_PROMPTS: Record<ArtifactType, PromptTemplate> = {
  note: {
    system: `Bạn là trợ lý ghi chú. Tóm lược nội dung thành ghi chú ngắn gọn, dễ quét, dùng Markdown.\n${COMMON_RULES}`,
    user: `Viết một ghi chú tóm tắt các ý chính từ nguồn.\n{{instructions}}`,
    options: { length: "ngắn" },
  },
  report: {
    system: `Bạn là chuyên viên phân tích viết báo cáo rõ ràng, có cấu trúc: tóm tắt điều hành, các phần chính có tiêu đề, kết luận và đề xuất. Dùng Markdown.\n${COMMON_RULES}`,
    user: `Soạn một báo cáo đầy đủ dựa trên các nguồn đã chọn.\n{{instructions}}`,
    options: { length: "vừa", tone: "chuyên nghiệp" },
  },
  study_guide: {
    system: `Bạn là giảng viên soạn tài liệu ôn tập: mục tiêu học tập, khái niệm chính (kèm định nghĩa), ví dụ, câu hỏi tự kiểm tra, thuật ngữ. Dùng Markdown.\n${COMMON_RULES}`,
    user: `Tạo hướng dẫn học tập từ các nguồn đã chọn.\n{{instructions}}`,
    options: { level: "trung bình" },
  },
  faq: {
    system: `Bạn tạo bộ câu hỏi thường gặp (FAQ) từ nguồn: câu hỏi tự nhiên, trả lời ngắn gọn, chính xác, nhóm theo chủ đề. Dùng Markdown.\n${COMMON_RULES}`,
    user: `Tạo bộ FAQ từ các nguồn đã chọn.\n{{instructions}}`,
    options: { count: 12 },
  },
  timeline: {
    system: `Bạn dựng dòng thời gian theo thứ tự thời gian từ nguồn: mỗi mục gồm mốc thời gian, sự kiện, ý nghĩa. Chỉ dùng mốc có trong nguồn. Dùng Markdown.\n${COMMON_RULES}`,
    user: `Dựng dòng thời gian các sự kiện quan trọng từ nguồn.\n{{instructions}}`,
    options: {},
  },
  mindmap: {
    system: `Bạn xây sơ đồ tư duy: một nút gốc là chủ đề trung tâm, 4–8 nhánh chính, mỗi nhánh tối đa 3 cấp con, nhãn ngắn (≤ 6 từ). Trả về JSON đúng schema.\n${COMMON_RULES}`,
    user: `Tạo sơ đồ tư duy từ các nguồn đã chọn.\n{{instructions}}`,
    options: { depth: 3 },
  },
  slide_deck: {
    system: `Bạn thiết kế bài thuyết trình: mỗi slide một thông điệp, tiêu đề dạng khẳng định, tối đa 5 gạch đầu dòng ngắn, ghi chú diễn giả cho từng slide, chọn layout phù hợp (title, title_bullets, two_column, image_text, chart, quote, section, closing). Trả về JSON đúng schema.\n${COMMON_RULES}`,
    user: `Tạo bài thuyết trình từ các nguồn đã chọn.\n{{instructions}}`,
    options: { slides: 12, audience: "chung" },
  },
  infographic: {
    system: `Bạn thiết kế infographic: tiêu đề, phụ đề, các khối thông tin (số liệu nổi bật, danh sách, quy trình, so sánh, trích dẫn). Văn bản ngắn, giàu số liệu có trong nguồn. Trả về JSON đúng schema.\n${COMMON_RULES}`,
    user: `Tạo infographic tóm tắt nội dung chính của nguồn.\n{{instructions}}`,
    options: { orientation: "portrait" },
  },
  quiz: {
    system: `Bạn soạn câu hỏi trắc nghiệm: mỗi câu có một đáp án đúng, các đáp án nhiễu hợp lý, giải thích ngắn gọn kèm trích dẫn, gắn mức độ khó. Trả về JSON đúng schema.\n${COMMON_RULES}`,
    user: `Tạo bộ câu hỏi kiểm tra từ các nguồn đã chọn.\n{{instructions}}`,
    options: { count: 10, difficulty: "trung bình" },
  },
  flashcards: {
    system: `Bạn tạo thẻ ghi nhớ: mặt trước là câu hỏi hoặc thuật ngữ, mặt sau là câu trả lời ngắn; mỗi thẻ một ý; có thể kèm gợi ý và thẻ phân loại. Trả về JSON đúng schema.\n${COMMON_RULES}`,
    user: `Tạo bộ thẻ ghi nhớ từ các nguồn đã chọn.\n{{instructions}}`,
    options: { count: 20 },
  },
  data_table: {
    system: `Bạn trích xuất dữ liệu có cấu trúc thành bảng: xác định cột phù hợp, mỗi dòng một thực thể, để trống nếu nguồn không có giá trị (không bịa). Trả về JSON đúng schema.\n${COMMON_RULES}`,
    user: `Trích xuất dữ liệu từ nguồn thành một bảng.\n{{instructions}}`,
    options: {},
  },
};

/** Gộp prompt mặc định với phần ghi đè của người dùng (`user_settings.prompts`). */
export function resolvePrompt(type: ArtifactType, override?: PromptOverride | null): PromptTemplate {
  const base = DEFAULT_PROMPTS[type];
  return {
    system: override?.system?.trim() ? override.system : base.system,
    user: override?.user?.trim() ? override.user : base.user,
    options: { ...base.options, ...(override?.options as PromptTemplate["options"] | undefined) },
  };
}

export function renderUserPrompt(template: PromptTemplate, instructions = ""): string {
  return template.user.replace("{{instructions}}", instructions.trim()).trim();
}

export function isArtifactType(v: string): v is ArtifactType {
  return (ARTIFACT_TYPES as readonly string[]).includes(v);
}

/* -------------------------------------------------------------------------- */
/* Chat AI (P2)                                                                */
/* -------------------------------------------------------------------------- */

/** Khoá trong `user_settings.prompts` cho prompt hội thoại (không phải loại artifact). */
export const CHAT_PROMPT_KEY = "chat";

/**
 * Prompt hệ thống mặc định cho Chat có trích dẫn (docs/02 §3.3). Các đoạn nguồn được đánh số [1..n]
 * ở tin nhắn của người dùng; mô hình chỉ được dùng đúng các số đó.
 */
export const defaultChatSystemPrompt = `Bạn là trợ lý nghiên cứu của KBM Notebook. Bạn trả lời câu hỏi của người dùng DỰA TRÊN các đoạn nguồn được đánh số [1], [2], … trong phần "NGUỒN" của tin nhắn.

Quy tắc trích dẫn (bắt buộc):
- Mỗi thông tin lấy từ nguồn phải kèm trích dẫn dạng [n] ngay sau câu hoặc ý đó; gộp nhiều nguồn dạng [1][3] hoặc [1, 3].
- CHỈ dùng các số [n] có trong danh sách NGUỒN. Không tự tạo số, không trích dẫn số không tồn tại, không dùng định dạng trích dẫn khác.
- Không bịa số liệu, tên, ngày tháng, trích dẫn nguyên văn hay kết luận mà nguồn không nói.
- Nếu các nguồn không có hoặc không liên quan tới câu hỏi, nói rõ đúng câu: "${NOT_FOUND_SENTINEL}." rồi (nếu hữu ích) gợi ý người dùng thêm nguồn hoặc đặt lại câu hỏi. Không suy đoán từ kiến thức ngoài nguồn khi chưa nói rõ điều đó.
- Nếu nguồn chỉ trả lời được một phần, trả lời phần có trong nguồn (kèm [n]) và nêu rõ phần còn thiếu.
- Khi các nguồn mâu thuẫn nhau, nêu cả hai quan điểm kèm trích dẫn tương ứng.

Cách trình bày:
- Trả lời bằng ngôn ngữ của câu hỏi (mặc định tiếng Việt).
- Dùng Markdown có cấu trúc: đoạn ngắn, danh sách gạch đầu dòng/đánh số, **in đậm** ý chính, bảng khi so sánh; không lặp lại câu hỏi; không chèn danh sách nguồn ở cuối (giao diện tự hiển thị).
- Với lịch sử hội thoại, chỉ dùng để hiểu ngữ cảnh câu hỏi hiện tại; số [n] luôn tính theo danh sách NGUỒN của lượt này.`;

/** Mẫu tin nhắn người dùng cho chat; `{{question}}` là câu hỏi (nguồn luôn được thêm phía trên). */
export const DEFAULT_CHAT_USER_TEMPLATE = "{{question}}";

export const DEFAULT_CHAT_PROMPT = { system: defaultChatSystemPrompt, user: DEFAULT_CHAT_USER_TEMPLATE } as const;

export type ResolvedChatPrompt = { system: string; user: string };

/** Gộp prompt chat mặc định với phần ghi đè của người dùng (`user_settings.prompts.chat`). */
export function resolveChatPrompt(override?: PromptOverride | null): ResolvedChatPrompt {
  return {
    system: override?.system?.trim() ? override.system : defaultChatSystemPrompt,
    user: override?.user?.trim() ? override.user : DEFAULT_CHAT_USER_TEMPLATE,
  };
}

/** Chèn câu hỏi vào mẫu tin nhắn; mẫu không có `{{question}}` thì câu hỏi được nối vào cuối. */
export function renderChatUserPrompt(template: string, question: string): string {
  const q = question.trim();
  return template.includes("{{question}}") ? template.replace("{{question}}", () => q).trim() : `${template.trim()}\n\n${q}`;
}

/** Ghép chỉ dẫn hệ thống: prompt chat + chỉ dẫn riêng của sổ tay (nếu có). */
export function composeChatSystem(system: string, notebookInstruction?: string | null): string {
  const extra = notebookInstruction?.trim();
  return extra ? `${system}\n\nChỉ dẫn riêng của sổ tay này (áp dụng thêm, không được trái quy tắc trích dẫn ở trên):\n${extra}` : system;
}
