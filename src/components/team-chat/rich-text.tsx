"use client";
import { Fragment, type ReactNode } from "react";
import { parseMarkdownLite, type InlineNode } from "@/lib/team-chat/markdown";
import { cn } from "@/lib/utils";

function renderInline(nodes: InlineNode[], meId: string, keyPrefix = ""): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}${i}`;
    switch (n.type) {
      case "text":
        return <Fragment key={key}>{n.text}</Fragment>;
      case "br":
        return <br key={key} />;
      case "bold":
        return <strong key={key}>{renderInline(n.children, meId, `${key}-`)}</strong>;
      case "italic":
        return <em key={key}>{renderInline(n.children, meId, `${key}-`)}</em>;
      case "strike":
        return <s key={key}>{renderInline(n.children, meId, `${key}-`)}</s>;
      case "code":
        return (
          <code key={key} className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]">
            {n.text}
          </code>
        );
      case "link":
        return (
          <a key={key} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 hover:opacity-80">
            {n.text}
          </a>
        );
      case "mention":
        return (
          <span
            key={key}
            data-mention={n.id}
            className={cn(
              "rounded px-1 font-medium",
              n.id === meId ? "bg-amber-500/25 text-amber-800 dark:text-amber-200" : "bg-primary/15 text-primary",
            )}
          >
            @{n.name}
          </span>
        );
    }
  });
}

/** Hiển thị nội dung tin nhắn (markdown-lite + mention), không bao giờ chèn HTML thô. */
export function RichText({ content, meId, className }: { content: string; meId: string; className?: string }) {
  const blocks = parseMarkdownLite(content);
  return (
    <div className={cn("whitespace-pre-wrap break-words", className)}>
      {blocks.map((b, i) => {
        if (b.type === "codeblock") {
          return (
            <pre key={i} className="my-1 overflow-x-auto rounded-md bg-foreground/10 p-2 font-mono text-xs">
              {b.text}
            </pre>
          );
        }
        if (b.type === "quote") {
          return (
            <blockquote key={i} className="my-1 border-l-2 border-foreground/30 pl-2 opacity-90">
              {renderInline(b.children, meId, `q${i}-`)}
            </blockquote>
          );
        }
        return <p key={i}>{renderInline(b.children, meId, `p${i}-`)}</p>;
      })}
    </div>
  );
}
