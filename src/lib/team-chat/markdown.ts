/**
 * Markdown-lite cho tin nhắn: **đậm**, *nghiêng* / _nghiêng_, ~~gạch~~, `mã`, ```khối mã```,
 * liên kết http(s) tự nhận diện, dòng bắt đầu bằng "> " là trích dẫn. Không bao giờ sinh HTML thô.
 */
import { splitMentions } from "./mentions";

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "strike"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; text: string }
  | { type: "mention"; id: string; name: string }
  | { type: "br" };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "quote"; children: InlineNode[] }
  | { type: "codeblock"; text: string };

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;

function linkify(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    // Bỏ dấu câu cuối khỏi liên kết.
    const raw = m[0];
    const trimmed = raw.replace(/[.,;:!?)\]]+$/, "");
    if (start > last) out.push({ type: "text", text: text.slice(last, start) });
    out.push({ type: "link", href: trimmed, text: trimmed });
    last = start + trimmed.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

const RULES: { re: RegExp; make: (inner: string) => InlineNode }[] = [
  { re: /^`([^`\n]+)`/, make: (s) => ({ type: "code", text: s }) },
  { re: /^\*\*([^\n]+?)\*\*/, make: (s) => ({ type: "bold", children: parseInline(s) }) },
  { re: /^~~([^\n]+?)~~/, make: (s) => ({ type: "strike", children: parseInline(s) }) },
  { re: /^\*([^*\s][^*\n]*?)\*/, make: (s) => ({ type: "italic", children: parseInline(s) }) },
  { re: /^_([^_\s][^_\n]*?)_(?![\p{L}\p{N}])/u, make: (s) => ({ type: "italic", children: parseInline(s) }) },
];

/** Phân tích một đoạn thành các nút inline (mention + định dạng + liên kết). */
export function parseInline(src: string): InlineNode[] {
  const out: InlineNode[] = [];
  for (const seg of splitMentions(src)) {
    if (seg.type === "mention") {
      out.push({ type: "mention", id: seg.id, name: seg.name });
      continue;
    }
    let rest = seg.text;
    let buf = "";
    const flush = () => {
      if (buf) {
        out.push(...linkify(buf));
        buf = "";
      }
    };
    while (rest.length > 0) {
      const ch = rest[0];
      let matched = false;
      if (ch === "`" || ch === "*" || ch === "~" || ch === "_") {
        // `_` chỉ có nghĩa khi đứng đầu từ (tránh snake_case).
        const prevIsWord = buf.length > 0 && /[\p{L}\p{N}]$/u.test(buf);
        if (!(ch === "_" && prevIsWord)) {
          for (const rule of RULES) {
            const m = rest.match(rule.re);
            if (m) {
              flush();
              out.push(rule.make(m[1]));
              rest = rest.slice(m[0].length);
              matched = true;
              break;
            }
          }
        }
      }
      if (!matched) {
        buf += ch;
        rest = rest.slice(1);
      }
    }
    flush();
  }
  return out;
}

function withBreaks(line: string): InlineNode[] {
  return parseInline(line);
}

/** Phân tích toàn bộ nội dung thành các khối. */
export function parseMarkdownLite(content: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length === 0) return;
    const children: InlineNode[] = [];
    para.forEach((l, idx) => {
      if (idx > 0) children.push({ type: "br" });
      children.push(...withBreaks(l));
    });
    blocks.push({ type: "paragraph", children });
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // bỏ dòng đóng (hoặc hết nội dung)
      blocks.push({ type: "codeblock", text: code.join("\n") });
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        q.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const children: InlineNode[] = [];
      q.forEach((l, idx) => {
        if (idx > 0) children.push({ type: "br" });
        children.push(...withBreaks(l));
      });
      blocks.push({ type: "quote", children });
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}
