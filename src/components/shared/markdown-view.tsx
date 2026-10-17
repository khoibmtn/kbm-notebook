"use client";
import { marked, type Token, type Tokens } from "marked";
import { Fragment, useMemo, type ReactNode } from "react";
import { splitCitationMarkers } from "@/lib/artifacts/citations";
import { cn } from "@/lib/utils";

type Props = {
  markdown: string;
  /** Render chip trích dẫn `[n]`; mặc định hiển thị chữ `[n]`. */
  renderCitation?: (n: number) => ReactNode;
  className?: string;
};

function safeHref(href: string): string | null {
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function textWithCitations(text: string, render: (n: number) => ReactNode, keyPrefix: string): ReactNode[] {
  return splitCitationMarkers(text).map((p, i) =>
    p.type === "text" ? <Fragment key={`${keyPrefix}-${i}`}>{p.value}</Fragment> : <Fragment key={`${keyPrefix}-${i}`}>{render(p.n)}</Fragment>,
  );
}

function inline(tokens: Token[] | undefined, render: (n: number) => ReactNode, k: string): ReactNode[] {
  return (tokens ?? []).map((tok, i) => {
    const key = `${k}.${i}`;
    switch (tok.type) {
      case "text": {
        const t = tok as Tokens.Text;
        return <Fragment key={key}>{t.tokens?.length ? inline(t.tokens, render, key) : textWithCitations(t.text, render, key)}</Fragment>;
      }
      case "escape":
        return <Fragment key={key}>{(tok as Tokens.Escape).text}</Fragment>;
      case "strong":
        return <strong key={key}>{inline((tok as Tokens.Strong).tokens, render, key)}</strong>;
      case "em":
        return <em key={key}>{inline((tok as Tokens.Em).tokens, render, key)}</em>;
      case "del":
        return <del key={key}>{inline((tok as Tokens.Del).tokens, render, key)}</del>;
      case "codespan":
        return <code key={key}>{(tok as Tokens.Codespan).text}</code>;
      case "br":
        return <br key={key} />;
      case "link": {
        const l = tok as Tokens.Link;
        const href = safeHref(l.href);
        return href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {inline(l.tokens, render, key)}
          </a>
        ) : (
          <Fragment key={key}>{inline(l.tokens, render, key)}</Fragment>
        );
      }
      case "image":
        return <Fragment key={key}>{(tok as Tokens.Image).text}</Fragment>;
      case "checkbox":
        return <input key={key} type="checkbox" checked={(tok as Tokens.Checkbox).checked} readOnly disabled className="mr-1.5" />;
      default:
        // HTML thô hiển thị như văn bản — không bao giờ chèn HTML từ nội dung.
        return <Fragment key={key}>{(tok as { text?: string; raw?: string }).text ?? (tok as { raw?: string }).raw ?? ""}</Fragment>;
    }
  });
}

function blocks(tokens: Token[], render: (n: number) => ReactNode, k: string): ReactNode[] {
  const out: ReactNode[] = [];
  tokens.forEach((tok, i) => {
    const key = `${k}.${i}`;
    switch (tok.type) {
      case "heading": {
        const h = tok as Tokens.Heading;
        const Tag = `h${Math.min(Math.max(h.depth, 1), 6)}` as "h1";
        out.push(<Tag key={key}>{inline(h.tokens, render, key)}</Tag>);
        break;
      }
      case "paragraph":
        out.push(<p key={key}>{inline((tok as Tokens.Paragraph).tokens, render, key)}</p>);
        break;
      case "text": {
        const t = tok as Tokens.Text;
        out.push(<Fragment key={key}>{t.tokens?.length ? inline(t.tokens, render, key) : textWithCitations(t.text, render, key)}</Fragment>);
        break;
      }
      case "list": {
        const l = tok as Tokens.List;
        const items = l.items.map((it, j) => <li key={`${key}.${j}`}>{blocks(it.tokens, render, `${key}.${j}`)}</li>);
        out.push(l.ordered ? <ol key={key} start={typeof l.start === "number" ? l.start : undefined}>{items}</ol> : <ul key={key}>{items}</ul>);
        break;
      }
      case "blockquote":
        out.push(<blockquote key={key}>{blocks((tok as Tokens.Blockquote).tokens, render, key)}</blockquote>);
        break;
      case "code":
        out.push(
          <pre key={key}>
            <code>{(tok as Tokens.Code).text}</code>
          </pre>,
        );
        break;
      case "table": {
        const tb = tok as Tokens.Table;
        out.push(
          <table key={key}>
            <thead>
              <tr>
                {tb.header.map((c, j) => (
                  <th key={j} style={tb.align[j] ? { textAlign: tb.align[j]! } : undefined}>
                    {inline(c.tokens, render, `${key}.h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j} style={tb.align[j] ? { textAlign: tb.align[j]! } : undefined}>
                      {inline(c.tokens, render, `${key}.r${ri}.${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>,
        );
        break;
      }
      case "hr":
        out.push(<hr key={key} />);
        break;
      case "html":
        out.push(<p key={key}>{(tok as Tokens.HTML).text}</p>);
        break;
      default:
        break;
    }
  });
  return out;
}

/** Hiển thị Markdown bằng React (không dùng dangerouslySetInnerHTML), có chip trích dẫn `[n]`. */
export function MarkdownView({ markdown, renderCitation, className }: Props) {
  const nodes = useMemo(() => {
    const render = renderCitation ?? ((n: number) => `[${n}]`);
    return blocks(marked.lexer(markdown, { gfm: true }), render, "m");
  }, [markdown, renderCitation]);
  return (
    <div className={cn("kbm-prose", className)} data-testid="markdown-view">
      {nodes}
    </div>
  );
}
