"use client";

import { ImageIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useT } from "@/lib/i18n-client";
import type { MessageKey } from "@/lib/i18n";
import { chartSvg } from "@/server/artifacts/slides/chart-svg";
import {
  SLIDE_H,
  SLIDE_W,
  layoutSlide,
  type BulletsElement,
  type SlideElement,
  type TableElement,
  type TextElement,
  type TextStyle,
} from "@/server/artifacts/slides/layouts";
import { insertBullet, removeBullet, setAt } from "@/server/artifacts/slides/ops";
import { fontOf } from "@/server/artifacts/slides/themes";
import type { Slide, SlideTheme } from "@/server/artifacts/slides/types";
import { EditableText } from "./editable-text";

export type SlideViewProps = {
  slide: Slide;
  theme: SlideTheme;
  index: number;
  total: number;
  /** Hệ số thu phóng của khung 1280×720 (mặc định 1). */
  scale?: number;
  resolveImageUrl?: (fileId: string) => string;
  /** Bật sửa trực tiếp từng phần tử. */
  editable?: boolean;
  onSlideChange?: (slide: Slide) => void;
  /** Bấm chip [n] ở chân slide; tham số là chỉ số 0-based trong `evidence`. */
  onEvidenceClick?: (evidenceIndex: number) => void;
  className?: string;
};

/** CSS cho chế độ sửa (viền nét đứt khi rê chuột, viền liền khi focus, gợi ý khi rỗng). */
export const SLIDE_EDIT_CSS = `
.kbm-slide [data-editable]{cursor:text;min-height:1em;width:100%;white-space:pre-wrap;overflow-wrap:break-word;border-radius:4px;outline:2px solid transparent;outline-offset:6px;transition:outline-color .12s}
.kbm-slide [data-editable]:hover{outline-color:rgba(99,102,241,.45)}
.kbm-slide [data-editable]:focus{outline:2px solid #6366f1;outline-offset:6px}
.kbm-slide [data-editable][data-placeholder]:empty::before{content:attr(data-placeholder);opacity:.45;pointer-events:none}
`;

const JUSTIFY = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

function textStyle(el: { box: { x: number; y: number; w: number; h: number } }, s: TextStyle): CSSProperties {
  return {
    position: "absolute",
    left: el.box.x,
    top: el.box.y,
    width: el.box.w,
    height: el.box.h,
    display: "flex",
    flexDirection: "column",
    justifyContent: JUSTIFY[s.valign],
    fontSize: s.size,
    fontWeight: s.weight,
    color: s.color,
    lineHeight: s.lineHeight,
    textAlign: s.align,
    fontStyle: s.italic ? "italic" : undefined,
    textTransform: s.uppercase ? "uppercase" : undefined,
    letterSpacing: s.letterSpacing ? `${s.letterSpacing}px` : undefined,
  };
}

type Ctx = {
  slide: Slide;
  theme: SlideTheme;
  index: number;
  editable: boolean;
  t: (k: MessageKey) => string;
  change: (s: Slide) => void;
  focusLater: (field: string, atEnd?: boolean) => void;
  resolveImageUrl?: (fileId: string) => string;
  onEvidenceClick?: (i: number) => void;
};

function imageSrc(slide: Slide, resolve?: (id: string) => string): string | null {
  const img = slide.image;
  if (!img) return null;
  if (img.fileId && resolve) return resolve(img.fileId);
  return img.dataUrl ?? null;
}

/** Đưa focus vào ô sửa `field` sau khi React vẽ lại (dùng khi Enter/Backspace thêm/xoá bullet). */
function focusField(slideId: string, field: string, atEnd: boolean) {
  window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>(`[data-slide-id="${slideId}"] [data-field="${field}"]`);
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(!atEnd);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, 0);
}

function focusFirstEditable(e: React.MouseEvent<HTMLElement>) {
  if (e.target !== e.currentTarget) return;
  const target = e.currentTarget.querySelector<HTMLElement>("[data-editable]");
  if (target) {
    e.preventDefault();
    target.focus();
  }
}

function TextBlock({ el, ctx }: { el: TextElement; ctx: Ctx }) {
  const style = textStyle(el, el.style);
  if (ctx.editable && el.field) {
    const field = el.field;
    return (
      <div data-key={el.key} style={style} onMouseDown={focusFirstEditable}>
        <EditableText
          value={el.text}
          field={field}
          placeholder={el.placeholder ? ctx.t(el.placeholder as MessageKey) : undefined}
          onCommit={(v) => ctx.change(setAt(ctx.slide, field, v))}
        />
      </div>
    );
  }
  return (
    <div data-key={el.key} style={style}>
      <div style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word", width: "100%" }}>{el.text}</div>
    </div>
  );
}

function BulletsBlock({ el, ctx }: { el: BulletsElement; ctx: Ctx }) {
  const style = textStyle(el, el.style);
  const items = ctx.editable ? (el.items.length > 0 ? el.items : [""]) : el.items.filter((i) => i.trim());
  return (
    <div data-key={el.key} style={style}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, width: "100%" }}>
        {items.map((it, i) => (
          <li key={i} style={{ position: "relative", paddingLeft: el.indent, marginTop: i > 0 ? el.gap : 0, overflowWrap: "break-word", whiteSpace: "pre-wrap" }}>
            <span style={{ position: "absolute", left: 0, top: 0, width: el.indent }}>{"•"}</span>
            {ctx.editable ? (
              <EditableText
                value={it}
                field={`${el.field}.${i}`}
                placeholder={el.placeholder ? ctx.t(el.placeholder as MessageKey) : undefined}
                onCommit={(v) => {
                  const cur = (el.items.length > 0 ? el.items : [""]).slice();
                  cur[i] = v;
                  ctx.change(setAt(ctx.slide, el.field, cur.filter((x) => x.trim() !== "")));
                }}
                singleLine
                onEnter={(split) => {
                  const base = el.items.length > 0 ? ctx.slide : setAt(ctx.slide, el.field, [""]);
                  ctx.change(insertBullet(base, el.field, i, split));
                  ctx.focusLater(`${el.field}.${i + 1}`, false);
                }}
                onBackspaceEmpty={() => {
                  if (items.length <= 1) return;
                  ctx.change(removeBullet(ctx.slide, el.field, i));
                  ctx.focusLater(`${el.field}.${Math.max(0, i - 1)}`, true);
                }}
              />
            ) : (
              it
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TableBlock({ el, ctx }: { el: TableElement; ctx: Ctx }) {
  const cell = (txt: string, field: string, bold: boolean, bg: string | null, color: string, h: number, last: boolean) => (
    <td
      key={field}
      style={{
        height: h,
        padding: "0 14px",
        verticalAlign: "middle",
        fontSize: el.fontSize,
        fontWeight: bold ? 700 : 400,
        color,
        background: bg ?? undefined,
        borderRight: last ? undefined : `1px solid ${el.borderColor}`,
        borderBottom: `1px solid ${el.borderColor}`,
        overflowWrap: "break-word",
      }}
    >
      {ctx.editable ? (
        <EditableText value={txt} field={field} onCommit={(v) => ctx.change(setAt(ctx.slide, field, v))} />
      ) : (
        txt
      )}
    </td>
  );
  const n = el.headers.length;
  return (
    <div data-key={el.key} style={{ position: "absolute", left: el.box.x, top: el.box.y, width: el.box.w, height: el.box.h }}>
      <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "100%" }}>
        <colgroup>
          {el.colW.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <tbody>
          <tr>{el.headers.map((h, c) => cell(h, `table.headers.${c}`, true, el.headerFill, el.headerColor, el.rowH[0], c === n - 1))}</tr>
          {el.rows.map((r, ri) => (
            <tr key={ri}>
              {el.headers.map((_, c) => cell(r[c] ?? "", `table.rows.${ri}.${c}`, false, ri % 2 === 1 ? el.zebraFill : null, el.textColor, el.rowH[ri + 1], c === n - 1))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderElement(el: SlideElement, ctx: Ctx) {
  switch (el.type) {
    case "shape":
      return (
        <div
          key={el.key}
          data-key={el.key}
          style={{
            position: "absolute",
            left: el.box.x,
            top: el.box.y,
            width: el.box.w,
            height: el.box.h,
            background: el.fill,
            opacity: el.opacity,
            borderRadius: el.shape === "ellipse" ? "50%" : el.radius,
          }}
        />
      );
    case "text":
      return <TextBlock key={el.key} el={el} ctx={ctx} />;
    case "bullets":
      return <BulletsBlock key={el.key} el={el} ctx={ctx} />;
    case "image": {
      const src = imageSrc(ctx.slide, ctx.resolveImageUrl);
      return (
        <div
          key={el.key}
          data-key={el.key}
          style={{ position: "absolute", left: el.box.x, top: el.box.y, width: el.box.w, height: el.box.h, background: el.fill, borderRadius: el.radius, overflow: "hidden" }}
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- ảnh data URL / file nội bộ, kích thước do bố cục quyết định
            <img src={src} alt={el.image?.caption ?? el.image?.prompt ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>
              <ImageIcon size={72} strokeWidth={1.25} aria-hidden />
            </div>
          )}
        </div>
      );
    }
    case "chart": {
      const svg = chartSvg(el.chart, {
        w: el.box.w,
        h: el.box.h,
        colors: el.colors,
        textColor: el.textColor,
        gridColor: el.gridColor,
        fontSize: el.fontSize,
        fontFamily: fontOf(ctx.theme).css,
      });
      return (
        <div
          key={el.key}
          data-key={el.key}
          style={{ position: "absolute", left: el.box.x, top: el.box.y, width: el.box.w, height: el.box.h }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      );
    }
    case "table":
      return <TableBlock key={el.key} el={el} ctx={ctx} />;
    case "slideNumber":
      return (
        <div key={el.key} data-key={el.key} style={textStyle(el, el.style)}>
          <div>{ctx.index + 1}</div>
        </div>
      );
    case "citations": {
      const clickable = Boolean(ctx.onEvidenceClick);
      return (
        <div key={el.key} data-key={el.key} style={{ ...textStyle(el, el.style), flexDirection: "row", justifyContent: "flex-start", alignItems: "center", gap: 8 }}>
          <span>{ctx.t("slides.citations.label")}</span>
          {el.numbers.map((n) =>
            clickable ? (
              <button
                key={n}
                type="button"
                data-testid={`citation-chip-${n}`}
                onClick={() => ctx.onEvidenceClick?.(n - 1)}
                style={{ all: "unset", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
              >
                [{n}]
              </button>
            ) : (
              <span key={n}>[{n}]</span>
            ),
          )}
        </div>
      );
    }
  }
}

/**
 * Bộ vẽ slide thuần — dùng chung cho canvas editor, thumbnail, trình chiếu.
 * Hình học lấy từ `layoutSlide` (cùng nguồn với HTML in và PPTX).
 */
export function SlideView({
  slide,
  theme,
  index,
  total,
  scale = 1,
  resolveImageUrl,
  editable = false,
  onSlideChange,
  onEvidenceClick,
  className,
}: SlideViewProps) {
  const t = useT();
  const canEdit = editable && Boolean(onSlideChange);
  const render = layoutSlide(slide, theme, { index, total, edit: canEdit });

  const ctx: Ctx = {
    slide,
    theme,
    index,
    editable: canEdit,
    t: (k) => t(k),
    change: (s) => onSlideChange?.(s),
    focusLater: (field, atEnd = false) => focusField(slide.id, field, atEnd),
    resolveImageUrl,
    onEvidenceClick,
  };

  return (
    <div
      className={className}
      style={{ width: SLIDE_W * scale, height: SLIDE_H * scale, position: "relative", overflow: "hidden", flex: "none" }}
      data-testid="slide-view"
    >
      {canEdit && <style>{SLIDE_EDIT_CSS}</style>}
      <div
        className="kbm-slide"
        data-slide-id={slide.id}
        data-layout={slide.layout}
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          position: "absolute",
          left: 0,
          top: 0,
          overflow: "hidden",
          background: render.background,
          fontFamily: fontOf(theme).css,
        }}
      >
        {render.elements.map((el) => renderElement(el, ctx))}
      </div>
    </div>
  );
}
