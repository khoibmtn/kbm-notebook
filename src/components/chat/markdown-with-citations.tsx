"use client";
import { ExternalLink, Globe } from "lucide-react";
import { Fragment, memo, useMemo, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { findCitations } from "@/lib/citations";
import type { Evidence } from "@/lib/chat";
import { useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Plugin remark: [n] → nút trích dẫn                                          */
/* -------------------------------------------------------------------------- */

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
};

const SKIP_PARENTS = new Set(["code", "inlineCode", "link", "linkReference", "definition", "html"]);

function splitTextNode(node: MdNode): MdNode[] | null {
  const text = node.value ?? "";
  const tokens = findCitations(text);
  if (tokens.length === 0) return null;
  const out: MdNode[] = [];
  let cursor = 0;
  for (const tok of tokens) {
    if (tok.start > cursor) out.push({ type: "text", value: text.slice(cursor, tok.start) });
    out.push({
      type: "citation",
      data: { hName: "citation-chip", hProperties: { numbers: tok.numbers.join(","), raw: tok.raw } },
    });
    cursor = tok.end;
  }
  if (cursor < text.length) out.push({ type: "text", value: text.slice(cursor) });
  return out;
}

function transform(node: MdNode): void {
  if (!node.children || SKIP_PARENTS.has(node.type)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      next.push(...(splitTextNode(child) ?? [child]));
    } else {
      transform(child);
      next.push(child);
    }
  }
  node.children = next;
}

/** Plugin remark: thay `[1]`, `[1, 3]`, `[2-4]` trong văn bản bằng phần tử `citation-chip`. */
export function remarkCitations() {
  return (tree: MdNode) => transform(tree);
}

/* -------------------------------------------------------------------------- */
/* Chip trích dẫn                                                              */
/* -------------------------------------------------------------------------- */

export function evidenceExcerpt(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + "…" : flat;
}

export function evidenceLocatorLabel(ev: Evidence, t: ReturnType<typeof useT>): string {
  const parts: string[] = [];
  if (ev.locator.page != null) parts.push(t("chat.locator.page", { n: ev.locator.page }));
  if (ev.locator.slide != null) parts.push(t("chat.locator.slide", { n: ev.locator.slide }));
  if (ev.locator.section) parts.push(t("chat.locator.section", { name: ev.locator.section }));
  if (ev.provider === "web" && ev.locator.url) {
    try {
      parts.push(new URL(ev.locator.url).hostname.replace(/^www\./, ""));
    } catch {
      parts.push(ev.locator.url);
    }
  }
  return parts.join(" · ");
}

export type CitationChipProps = {
  n: number;
  evidence: Evidence;
  onOpen?: (n: number, evidence: Evidence) => void;
};

/** Nút trích dẫn dạng pill `[n]`: hover → tên nguồn, vị trí, trích đoạn 200 ký tự; bấm → mở nguồn (hoặc URL với web). */
export function CitationChip({ n, evidence, onOpen }: CitationChipProps) {
  const t = useT();
  const where = evidenceLocatorLabel(evidence, t);
  const isWeb = evidence.provider === "web";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="citation-chip"
          data-citation={n}
          aria-label={t("chat.citation.aria", { n, title: evidence.sourceTitle })}
          onClick={() => {
            if (isWeb && evidence.locator.url) window.open(evidence.locator.url, "_blank", "noopener,noreferrer");
            else onOpen?.(n, evidence);
          }}
          className="mx-0.5 inline-flex h-[18px] min-w-[22px] -translate-y-px cursor-pointer items-center justify-center rounded-full bg-primary/10 px-1.5 align-baseline text-[11px] font-medium leading-none text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          [{n}]
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm space-y-1 p-3 text-left" data-testid="citation-tooltip">
        <div className="flex items-start gap-1.5 text-xs font-semibold">
          {isWeb ? <Globe className="mt-0.5 size-3 shrink-0" aria-hidden /> : null}
          <span className="break-words">{evidence.sourceTitle}</span>
        </div>
        {where && <div className="text-[11px] opacity-80">{where}</div>}
        <p className="text-xs leading-snug opacity-90">{evidenceExcerpt(evidence.text)}</p>
        <div className="flex items-center gap-1 text-[11px] opacity-70">
          {isWeb ? <ExternalLink className="size-3" aria-hidden /> : null}
          {isWeb ? t("chat.citation.openWeb") : t("chat.citation.open")}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

type ChipGroupProps = { numbers?: string; raw?: string; evidence?: Evidence[]; onOpen?: CitationChipProps["onOpen"] };

function ChipGroup({ numbers = "", raw, evidence, onOpen }: ChipGroupProps) {
  const list = numbers
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n));
  // Chưa có danh sách bằng chứng (vd. hiển thị văn bản thô): giữ nguyên chữ.
  if (!evidence) return <>{raw ?? list.map((n) => `[${n}]`).join("")}</>;
  return (
    <>
      {list.map((n) => {
        const ev = evidence[n - 1];
        // `[n]` không có trong danh sách (mô hình bịa, hoặc đang stream) bị ẩn — khớp bước hậu kiểm ở server.
        return ev ? <CitationChip key={n} n={n} evidence={ev} onOpen={onOpen} /> : <Fragment key={n} />;
      })}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Thành phần Markdown                                                         */
/* -------------------------------------------------------------------------- */

function A({ href, children }: ComponentProps<"a">) {
  const external = typeof href === "string" && /^https?:/i.test(href);
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer nofollow" : undefined}
      className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  );
}

/** Kiểu chữ cho nội dung Markdown (không phụ thuộc @tailwindcss/typography). */
export const markdownComponents: Components = {
  a: A,
  h1: ({ children }) => <h3 className="mb-2 mt-4 text-lg font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mb-1.5 mt-3 text-[15px] font-semibold first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="mb-1.5 mt-3 text-[15px] font-semibold first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children, className }) => (
    <ul className={cn("my-2 ml-5 list-disc space-y-1 marker:text-muted-foreground", className?.includes("contains-task-list") && "ml-1 list-none")}>{children}</ul>
  ),
  ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-4 border-border" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children }) => <th className="border-b px-3 py-2 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b px-3 py-2 align-top last:border-b-0">{children}</td>,
  pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-lg bg-muted p-3 text-[13px] leading-relaxed">{children}</pre>,
  code: ({ children, className }) =>
    className ? (
      <code className={cn("font-mono", className)}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
    ),
  input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} readOnly disabled className="mr-1.5 align-middle" />,
};

export type MarkdownWithCitationsProps = {
  /** Nội dung Markdown có `[n]`. */
  content: string;
  /** Bằng chứng đã đánh số (phần tử i ↔ `[i+1]`). Bỏ trống → `[n]` giữ nguyên dạng chữ. */
  evidence?: Evidence[];
  /** Gọi khi bấm một chip của nguồn cục bộ (web tự mở URL). */
  onCitationOpen?: CitationChipProps["onOpen"];
  /** Hiện con trỏ nhấp nháy ở cuối khi đang stream. */
  streaming?: boolean;
  className?: string;
};

/**
 * Render Markdown (GFM: bảng, danh sách, mã) và biến `[n]` thành chip trích dẫn có tooltip + mở nguồn.
 * Dùng chung cho Chat, ghi chú từ chat và Studio.
 */
export const MarkdownWithCitations = memo(function MarkdownWithCitations({
  content,
  evidence,
  onCitationOpen,
  streaming,
  className,
}: MarkdownWithCitationsProps) {
  const components = useMemo<Components>(
    () =>
      ({
        ...markdownComponents,
        "citation-chip": (props: { numbers?: string; raw?: string }): ReactNode => (
          <ChipGroup numbers={props.numbers} raw={props.raw} evidence={evidence} onOpen={onCitationOpen} />
        ),
      }) as Components,
    [evidence, onCitationOpen],
  );
  return (
    <div className={cn("text-[15px] leading-relaxed break-words", className)} data-testid="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCitations]} components={components}>
        {content}
      </ReactMarkdown>
      {streaming && <span aria-hidden className="ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] animate-pulse bg-foreground" data-testid="stream-caret" />}
    </div>
  );
});
