import "server-only";
import { marked, type Token, type Tokens } from "marked";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeHref(href: string): string | null {
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function inline(tokens: Token[] | undefined): string {
  let out = "";
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case "text": {
        const t = tok as Tokens.Text;
        out += t.tokens?.length ? inline(t.tokens) : escapeHtml(t.text);
        break;
      }
      case "escape":
        out += escapeHtml((tok as Tokens.Escape).text);
        break;
      case "strong":
        out += `<strong>${inline((tok as Tokens.Strong).tokens)}</strong>`;
        break;
      case "em":
        out += `<em>${inline((tok as Tokens.Em).tokens)}</em>`;
        break;
      case "del":
        out += `<del>${inline((tok as Tokens.Del).tokens)}</del>`;
        break;
      case "codespan":
        out += `<code>${escapeHtml((tok as Tokens.Codespan).text)}</code>`;
        break;
      case "br":
        out += "<br>";
        break;
      case "link": {
        const l = tok as Tokens.Link;
        const href = safeHref(l.href);
        out += href ? `<a href="${escapeHtml(href)}">${inline(l.tokens)}</a>` : inline(l.tokens);
        break;
      }
      case "image":
        out += escapeHtml((tok as Tokens.Image).text || "");
        break;
      case "checkbox":
        out += (tok as Tokens.Checkbox).checked ? "☑ " : "☐ ";
        break;
      default:
        // HTML thô trong markdown bị vô hiệu hoá (hiển thị như văn bản) — nội dung có thể đến từ nguồn không tin cậy.
        out += escapeHtml((tok as { text?: string; raw?: string }).text ?? (tok as { raw?: string }).raw ?? "");
    }
  }
  return out;
}

function block(tokens: Token[]): string {
  let out = "";
  for (const tok of tokens) {
    switch (tok.type) {
      case "heading": {
        const h = tok as Tokens.Heading;
        out += `<h${h.depth}>${inline(h.tokens)}</h${h.depth}>`;
        break;
      }
      case "paragraph":
        out += `<p>${inline((tok as Tokens.Paragraph).tokens)}</p>`;
        break;
      case "text": {
        const t = tok as Tokens.Text;
        out += t.tokens?.length ? inline(t.tokens) : escapeHtml(t.text);
        break;
      }
      case "list": {
        const l = tok as Tokens.List;
        const tag = l.ordered ? "ol" : "ul";
        const start = l.ordered && typeof l.start === "number" && l.start !== 1 ? ` start="${l.start}"` : "";
        out += `<${tag}${start}>${l.items.map((it) => `<li>${block(it.tokens)}</li>`).join("")}</${tag}>`;
        break;
      }
      case "blockquote":
        out += `<blockquote>${block((tok as Tokens.Blockquote).tokens)}</blockquote>`;
        break;
      case "code":
        out += `<pre><code>${escapeHtml((tok as Tokens.Code).text)}</code></pre>`;
        break;
      case "table": {
        const tb = tok as Tokens.Table;
        const cell = (tag: "th" | "td", c: Tokens.TableCell, i: number) => {
          const a = tb.align[i];
          return `<${tag}${a ? ` style="text-align:${a}"` : ""}>${inline(c.tokens)}</${tag}>`;
        };
        out += `<table><thead><tr>${tb.header.map((c, i) => cell("th", c, i)).join("")}</tr></thead><tbody>${tb.rows
          .map((r) => `<tr>${r.map((c, i) => cell("td", c, i)).join("")}</tr>`)
          .join("")}</tbody></table>`;
        break;
      }
      case "hr":
        out += "<hr>";
        break;
      case "html":
        out += `<p>${escapeHtml((tok as Tokens.HTML).text)}</p>`;
        break;
      default:
        break;
    }
  }
  return out;
}

/** Markdown → HTML an toàn (không bao giờ truyền HTML thô qua; liên kết chỉ http/https/mailto). */
export function markdownToHtml(markdown: string): string {
  return block(marked.lexer(markdown, { gfm: true }));
}

const PRINT_CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Inter", "Noto Sans", "DejaVu Sans", "Liberation Sans", Arial, sans-serif; font-size: 11pt; line-height: 1.55; color: #1b2430; margin: 0; }
  h1 { font-size: 22pt; margin: 0 0 12pt; color: #14213d; }
  h2 { font-size: 16pt; margin: 18pt 0 6pt; color: #14213d; border-bottom: 1px solid #dde3ea; padding-bottom: 3pt; }
  h3 { font-size: 13pt; margin: 14pt 0 4pt; color: #14213d; }
  h4, h5, h6 { font-size: 11.5pt; margin: 10pt 0 3pt; }
  p { margin: 0 0 8pt; }
  ul, ol { margin: 0 0 8pt; padding-left: 20pt; }
  li { margin: 2pt 0; }
  blockquote { margin: 0 0 8pt; padding: 2pt 10pt; border-left: 3px solid #9aa5b1; color: #4a5568; }
  code { font-family: "DejaVu Sans Mono", Consolas, monospace; font-size: 9.5pt; background: #f1f3f5; padding: 0 2pt; border-radius: 2pt; }
  pre { background: #f1f3f5; padding: 8pt; border-radius: 4pt; overflow-wrap: anywhere; white-space: pre-wrap; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 10pt; font-size: 10pt; }
  th, td { border: 1px solid #c5ccd3; padding: 4pt 6pt; vertical-align: top; text-align: left; }
  th { background: #eef1f5; }
  tr { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
  a { color: #1d4ed8; }
  hr { border: 0; border-top: 1px solid #dde3ea; margin: 12pt 0; }
`;

/** Trang HTML hoàn chỉnh để Chromium in ra PDF. */
export function renderDocumentHtml(markdown: string, title: string, lang = "vi"): string {
  return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>${markdownToHtml(markdown)}</body></html>`;
}
