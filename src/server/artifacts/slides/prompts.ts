import type { Slide, SlideOutline } from "./types";

/**
 * Prompt cho engine slide (2 giai đoạn: dàn ý → nội dung, và sửa một slide).
 * Viết bằng tiếng Việt; ngôn ngữ ĐẦU RA của slide do tham số `language` quyết định.
 */

export const LANGUAGE_NAMES: Record<string, string> = {
  vi: "tiếng Việt",
  en: "English",
  fr: "français",
  de: "Deutsch",
  es: "español",
  ja: "日本語",
  ko: "한국어",
  zh: "中文",
};

export function languageName(code?: string): string {
  if (!code) return LANGUAGE_NAMES.vi;
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code;
}

export const LAYOUT_GUIDE = `Các layout và khi nào dùng:
- "title": slide mở đầu DUY NHẤT (chỉ title + subtitle).
- "section": ngăn cách các phần lớn (chỉ title + subtitle một dòng). Dùng khi bộ slide ≥ 10 slide.
- "title_bullets": 3–6 ý chính của một thông điệp.
- "two_column": so sánh/đối lập (trước–sau, ưu–nhược, lý thuyết–thực tế); 2–3 cột.
- "image_text": ý chính + một hình minh hoạ trực quan (bắt buộc có image.prompt).
- "chart": số liệu theo hạng mục (bar), xu hướng theo thời gian (line), cơ cấu/tỷ trọng ≤ 6 phần (pie).
- "table": so sánh nhiều thuộc tính hoặc danh mục nhiều cột (2–5 cột, ≤ 8 hàng).
- "quote": MỘT câu trích nguyên văn nổi bật trong nguồn (chỉ khi nguồn thật sự có câu đáng trích).
- "closing": slide cuối: kết luận / bước tiếp theo (title + 2–4 bullets).`;

export const SLIDE_RULES = `Quy tắc bất biến:
1. CHỈ dùng thông tin trong các nguồn được đánh số [1], [2]... Không bịa số liệu, tên riêng, mốc thời gian, trích dẫn. Thiếu dữ liệu thì bỏ ý đó, không suy đoán.
2. Mỗi slide truyền đạt MỘT thông điệp. Tiêu đề là câu khẳng định ngắn (≤ 9 từ) nêu kết luận của slide, không phải nhãn chung chung như "Giới thiệu" hay "Nội dung".
3. Bullet ngắn gọn, đúng trọng tâm, không chấm câu cuối dòng, không lặp lại tiêu đề.
4. "citations" chỉ chứa SỐ THỨ TỰ [n] của nguồn mà slide thực sự dựa vào (ví dụ [1, 3]); không dùng số không có trong danh sách nguồn.
5. Số liệu trong biểu đồ/bảng phải lấy NGUYÊN từ nguồn (giữ đúng đơn vị); không tự tính ra số mới trừ phép cộng/chia phần trăm đơn giản và phải đúng.`;

export function slideCountInstruction(count: number | "auto", target: number): string {
  if (count !== "auto") return `Bộ slide gồm ĐÚNG ${count} slide.`;
  return `Số slide: khoảng ${target} (khoảng ${Math.max(5, target - 3)}–${target + 4}). Đây chỉ là gợi ý theo độ dài nguồn: nếu nội dung phong phú hãy dùng NHIỀU hơn, không có giới hạn cứng; tuyệt đối không nén nội dung quan trọng chỉ để cho ngắn.`;
}

export type PromptCtx = {
  contextText: string;
  instructions: string;
  language?: string;
  audience?: string;
  style: "detailed" | "concise";
  count: number | "auto";
  autoTarget: number;
  evidenceCount: number;
  hasNumeric: boolean;
};

function commonHeader(c: PromptCtx): string {
  const lines = [
    `Ngôn ngữ nội dung slide: ${languageName(c.language)}.`,
    c.audience ? `Đối tượng người xem: ${c.audience}.` : "",
    c.style === "concise"
      ? "Phong cách: súc tích — bullet ≤ 7 từ."
      : "Phong cách: chi tiết — bullet ≤ 12 từ, ghi chú diễn giả đầy đủ hơn.",
    c.instructions.trim() ? `Yêu cầu riêng của người dùng (ưu tiên làm theo nếu không mâu thuẫn quy tắc bất biến):\n${c.instructions.trim()}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- giai đoạn 1: dàn ý

export const OUTLINE_SYSTEM = `Bạn là chuyên gia thiết kế bài thuyết trình, giỏi dựng mạch kể chuyện và chọn hình thức trình bày phù hợp. Nhiệm vụ: lập DÀN Ý chi tiết của bộ slide từ các nguồn tri thức đã đánh số.

${SLIDE_RULES}

Mạch kể chuyện: mở đầu (layout "title") → bối cảnh/vấn đề → các phần chính (mỗi phần có thể mở bằng slide "section" khi bộ ≥ 10 slide) → số liệu/so sánh/ví dụ → kết luận hoặc hành động (layout "closing"). Sắp xếp theo logic, không lặp ý giữa các slide, đa dạng layout (không dùng "title_bullets" cho mọi slide).

${LAYOUT_GUIDE}

Chỉ trả về JSON đúng schema.`;

export function buildOutlineUser(c: PromptCtx): string {
  return `${commonHeader(c)}
${slideCountInstruction(c.count, c.autoTarget)}
${
  c.hasNumeric
    ? "Nguồn CÓ số liệu: hãy lên kế hoạch ít nhất một slide layout \"chart\" hoặc \"table\" cho số liệu quan trọng nhất."
    : "Nguồn ít số liệu: chỉ dùng \"chart\"/\"table\" nếu thực sự có dữ liệu để trình bày."
}
Có ${c.evidenceCount} nguồn đánh số [1]..[${c.evidenceCount}].

Với mỗi slide trong dàn ý: "layout", "title" (câu khẳng định ngắn), "purpose" (1 câu: slide này truyền đạt điều gì), "section" (tên phần) và "citations" (các [n] sẽ dùng). Thêm "sections" (tên + tóm tắt 1 câu) và "palette" (indigo|emerald|rose|amber|slate|ocean) hợp với chủ đề.

NGUỒN:
${c.contextText}`;
}

// ---------------------------------------------------------------- giai đoạn 2: nội dung

export const CONTENT_SYSTEM = `Bạn là chuyên gia viết nội dung slide. Từ dàn ý đã duyệt và các nguồn đánh số, hãy viết NỘI DUNG ĐẦY ĐỦ cho từng slide, đúng thứ tự và đúng số lượng slide trong dàn ý.

${SLIDE_RULES}

Yêu cầu theo layout (chỉ điền các trường liên quan layout):
- title: "title" (tên bài), "subtitle" (1 dòng nêu phạm vi/đối tượng). Không bullets.
- section: "title", "subtitle" (1 dòng dẫn dắt).
- title_bullets: "bullets" 3–6 dòng (TỐI ĐA 6).
- two_column: "columns" 2–3 cột, mỗi cột "heading" (≤ 3 từ) + "bullets" 2–4 dòng.
- image_text: "bullets" 2–4 dòng + "image": { "prompt": mô tả cảnh bằng TIẾNG ANH, cụ thể (chủ thể, bối cảnh, bố cục), phong cách minh hoạ phẳng hiện đại, KHÔNG có chữ/logo trong ảnh; "caption": chú thích ngắn }.
- chart: "chart": { "type": "bar"|"line"|"pie", "labels": [...], "series": [{ "name", "values": [...] }] } — mỗi series có số giá trị BẰNG số labels; pie chỉ 1 series, ≤ 6 phần; số liệu lấy nguyên từ nguồn. Thêm "bullets" 2–3 dòng nêu nhận xét chính (tuỳ chọn).
- table: "table": { "headers": [2–5 cột], "rows": [≤ 8 hàng, mỗi hàng đủ số ô bằng số cột, ô ≤ 8 từ] }.
- quote: "quote": { "text": câu trích NGUYÊN VĂN từ nguồn, "attribution": tên nguồn/tác giả }.
- closing: "title", "bullets" 2–4 dòng (kết luận/bước tiếp theo), "subtitle" tuỳ chọn.

Mọi slide: "notes" = ghi chú diễn giả 2–4 câu, văn nói tự nhiên, bổ sung ý (không chép lại bullet), và "citations" = các số [n] đã dùng.
Giữ nguyên "layout" và thứ tự của dàn ý; có thể tinh chỉnh tiêu đề cho chặt hơn. Chỉ trả về JSON đúng schema (gồm "theme" và "slides").`;

export function buildContentUser(c: PromptCtx, outline: SlideOutline): string {
  const outlineText = outline.slides
    .map((s, i) => `${i + 1}. [${s.layout}] ${s.title} — ${s.purpose}${s.citations?.length ? ` (nguồn ${s.citations.map((n) => `[${n}]`).join("")})` : ""}`)
    .join("\n");
  return `${commonHeader(c)}
Tiêu đề bộ slide: ${outline.deckTitle}
Theme: palette "${outline.palette ?? "indigo"}", font "Inter".
${c.hasNumeric ? 'Nguồn CÓ số liệu: bảo đảm có ít nhất một slide "chart" hoặc "table" thể hiện số liệu thật của nguồn.' : ""}

DÀN Ý (${outline.slides.length} slide — phải trả về đúng ${outline.slides.length} slide, cùng thứ tự):
${outlineText}

NGUỒN:
${c.contextText}`;
}

// ---------------------------------------------------------------- sửa một slide

export const EDIT_SLIDE_SYSTEM = `Bạn là biên tập viên slide. Bạn nhận MỘT slide hiện tại (JSON), danh sách tiêu đề các slide khác để giữ mạch, và một chỉ dẫn chỉnh sửa. Hãy viết lại CHỈ slide đó theo chỉ dẫn và trả về JSON của đúng một slide.

${SLIDE_RULES}

${LAYOUT_GUIDE}

Chỉ thay đổi những gì chỉ dẫn yêu cầu; giữ nguyên ngôn ngữ, giọng văn và các thông tin không bị yêu cầu đổi. Có thể đổi "layout" nếu chỉ dẫn đòi hỏi (khi đó điền đủ trường mà layout mới cần). Bullet ≤ 7 từ, tối đa 6 bullet; "notes" 2–4 câu. Chỉ trả về JSON đúng schema.`;

export function buildEditSlideUser(args: {
  slide: Omit<Slide, "id">;
  otherTitles: string[];
  instruction: string;
  contextText?: string;
  evidenceCount: number;
}): string {
  return `CHỈ DẪN CHỈNH SỬA: ${args.instruction.trim()}

SLIDE HIỆN TẠI (JSON):
${JSON.stringify(args.slide, null, 2)}

CÁC SLIDE TRONG BỘ (để giữ mạch, không sửa):
${args.otherTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}
${
  args.contextText
    ? `\nNGUỒN (đánh số [1]..[${args.evidenceCount}]; chỉ dùng khi cần bổ sung thông tin):\n${args.contextText}`
    : `\nKhông có nguồn mới: chỉ chỉnh sửa/diễn đạt lại dựa trên nội dung slide hiện tại, không thêm số liệu hay sự kiện mới. Giữ nguyên "citations" nếu nội dung không đổi ý.`
}`;
}

export function retrySuffix(errors: string[]): string {
  return `\n\n---\nKẾT QUẢ LẦN TRƯỚC KHÔNG HỢP LỆ. Các lỗi cần sửa:\n${errors.map((e) => `- ${e}`).join("\n")}\nHãy trả lại TOÀN BỘ JSON đã sửa đúng các lỗi trên.`;
}
