/** Xử lý mention dạng `@[Tên](userId)` — hàm thuần, dùng cả server và client. */

const MENTION_RE =
  /@\[([^\]\n]{1,80})\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

export type MentionRef = { id: string; name: string };

/** Danh sách userId (không trùng, giữ thứ tự xuất hiện) trong nội dung. */
export function parseMentionIds(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(MENTION_RE)) {
    const id = m[2].toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Thay token mention bằng `@Tên` (dùng cho xem trước, thông báo). */
export function plainText(content: string): string {
  return content.replace(MENTION_RE, (_m, name: string) => `@${name}`);
}

export type MentionSegment = { type: "text"; text: string } | { type: "mention"; id: string; name: string };

/** Tách nội dung thành đoạn text / mention để render. */
export function splitMentions(content: string): MentionSegment[] {
  const out: MentionSegment[] = [];
  let last = 0;
  for (const m of content.matchAll(MENTION_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ type: "text", text: content.slice(last, start) });
    out.push({ type: "mention", id: m[2].toLowerCase(), name: m[1] });
    last = start + m[0].length;
  }
  if (last < content.length) out.push({ type: "text", text: content.slice(last) });
  return out;
}

/** Soạn thảo → nội dung gửi: thay `@Tên` (đã chọn trong popover) bằng token `@[Tên](id)`. */
export function encodeMentions(text: string, picked: MentionRef[]): string {
  if (picked.length === 0) return text;
  // Tên dài trước để "@Nguyễn Văn An" không bị "@Nguyễn Văn" khớp nhầm.
  const sorted = [...picked].sort((a, b) => b.name.length - a.name.length);
  let out = text;
  for (const p of sorted) {
    const needle = `@${p.name}`;
    let result = "";
    let i = 0;
    while (i < out.length) {
      const at = out.indexOf(needle, i);
      if (at === -1) {
        result += out.slice(i);
        break;
      }
      const before = at === 0 ? "" : out[at - 1];
      const after = out[at + needle.length] ?? "";
      // Chỉ thay khi đứng riêng: trước là đầu dòng/khoảng trắng/dấu mở, sau không phải chữ/số.
      const okBefore = before === "" || /\s|[([{]/.test(before);
      const okAfter = after === "" || !/[\p{L}\p{N}_]/u.test(after);
      if (okBefore && okAfter) {
        result += out.slice(i, at) + `@[${p.name}](${p.id})`;
      } else {
        result += out.slice(i, at + needle.length);
      }
      i = at + needle.length;
    }
    out = result;
  }
  return out;
}

/** Nội dung đã lưu → văn bản soạn thảo (`@Tên`) + danh sách mention đã chọn (khi sửa tin nhắn). */
export function decodeMentions(content: string): { text: string; picked: MentionRef[] } {
  const picked: MentionRef[] = [];
  const text = content.replace(MENTION_RE, (_m, name: string, id: string) => {
    const lid = id.toLowerCase();
    if (!picked.some((p) => p.id === lid)) picked.push({ id: lid, name });
    return `@${name}`;
  });
  return { text, picked };
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

/** Lọc thành viên theo từ khoá gõ sau `@` (không phân biệt dấu/hoa thường). */
export function filterMentionCandidates<T extends { name: string }>(members: T[], query: string, limit = 6): T[] {
  const q = fold(query.trim());
  const scored = members
    .map((m) => {
      const name = fold(m.name);
      let score = -1;
      if (q === "") score = 0;
      else if (name.startsWith(q)) score = 3;
      else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 2;
      else if (name.includes(q)) score = 1;
      return { m, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.m.name.localeCompare(b.m.name, "vi"));
  return scored.slice(0, limit).map((x) => x.m);
}

/**
 * Phát hiện truy vấn mention tại vị trí con trỏ: `@` đứng đầu hoặc sau khoảng trắng,
 * theo sau tối đa 30 ký tự không chứa xuống dòng. Trả về null nếu không có.
 */
export function detectMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || query.includes("\n")) return null;
  // Hai khoảng trắng liên tiếp hoặc quá 4 từ → coi như mention đã kết thúc.
  if (/\s{2,}/.test(query) || query.trim().split(/\s+/).length > 4) return null;
  return { start: at, query };
}
