"use client";

import { Check } from "lucide-react";
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocale, useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import { EditableText } from "@/components/studio/slides/editable-text";
import { SLIDE_EDIT_CSS } from "@/components/studio/slides/slide-view";
import { chartSvg } from "@/server/artifacts/slides/chart-svg";
import { setAt } from "@/server/artifacts/slides/ops";
import { PALETTES } from "@/server/artifacts/slides/themes";
import { SLIDE_PALETTES } from "@/server/artifacts/slides/types";
import { iconSvgInner } from "@/server/artifacts/infographic/export";
import { INFOGRAPHIC_FONT, layoutInfographic, type Prim } from "@/server/artifacts/infographic/layout";
import type { InfographicContent } from "@/server/artifacts/infographic/types";

export type InfographicViewProps = {
  content: InfographicContent;
  onChange?: (c: InfographicContent) => void;
  readOnly?: boolean;
  /** Bấm chip [n]; tham số là chỉ số 0-based trong `content.evidence`. */
  onEvidenceClick?: (evidenceIndex: number) => void;
  className?: string;
};

type Ctx = {
  editable: boolean;
  commit: (field: string, value: string) => void;
  onEvidenceClick?: (i: number) => void;
};

function PrimView({ p, ctx }: { p: Prim; ctx: Ctx }) {
  switch (p.type) {
    case "rect":
      return (
        <div
          data-key={p.key}
          style={{
            position: "absolute",
            left: p.x,
            top: p.y,
            width: p.w,
            height: p.h,
            background: p.fill,
            border: p.stroke ? `2px solid ${p.stroke}` : undefined,
            boxSizing: "border-box",
            borderRadius: p.radius,
            opacity: p.opacity,
          }}
        />
      );
    case "circle":
      return <div data-key={p.key} style={{ position: "absolute", left: p.cx - p.r, top: p.cy - p.r, width: p.r * 2, height: p.r * 2, borderRadius: "50%", background: p.fill, opacity: p.opacity }} />;
    case "line":
      return (
        <svg data-key={p.key} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={1} height={1}>
          <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.stroke} strokeWidth={p.width} strokeLinecap="round" />
        </svg>
      );
    case "icon":
      return (
        <svg
          data-key={p.key}
          style={{ position: "absolute", left: p.x, top: p.y }}
          width={p.size}
          height={p.size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={p.color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          dangerouslySetInnerHTML={{ __html: iconSvgInner(p.name) }}
        />
      );
    case "chart":
      return (
        <div
          data-key={p.key}
          style={{ position: "absolute", left: p.x, top: p.y, width: p.w, height: p.h }}
          dangerouslySetInnerHTML={{
            __html: chartSvg(p.chart, { w: p.w, h: p.h, colors: p.colors, textColor: p.textColor, gridColor: p.gridColor, fontSize: p.fontSize, fontFamily: INFOGRAPHIC_FONT.css }),
          }}
        />
      );
    case "citations":
      return (
        <div data-key={p.key} style={{ position: "absolute", left: p.x, top: p.y, width: p.w, fontSize: p.size, fontWeight: 500, color: p.color, display: "flex", gap: 8 }}>
          <span>{p.label}</span>
          {p.numbers.map((n) =>
            ctx.onEvidenceClick ? (
              <button key={n} type="button" data-testid={`info-citation-${n}`} onClick={() => ctx.onEvidenceClick?.(n - 1)} style={{ all: "unset", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>
                [{n}]
              </button>
            ) : (
              <span key={n}>[{n}]</span>
            ),
          )}
        </div>
      );
    case "text": {
      const style: CSSProperties = {
        position: "absolute",
        left: p.x,
        top: p.y,
        width: p.w,
        fontSize: p.size,
        fontWeight: p.weight,
        color: p.color,
        textAlign: p.align,
        lineHeight: p.lineHeight,
        fontStyle: p.italic ? "italic" : undefined,
      };
      if (ctx.editable && p.field) {
        const field = p.field;
        return (
          <div data-key={p.key} style={style}>
            <EditableText value={p.text} field={field} onCommit={(v) => ctx.commit(field, v)} />
          </div>
        );
      }
      return (
        <div data-key={p.key} style={{ ...style, whiteSpace: "nowrap" }}>
          {p.lines.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {l}
            </Fragment>
          ))}
        </div>
      );
    }
  }
}

/**
 * Hiển thị infographic bằng cùng bộ dàn trang với SVG xuất ra; sửa trực tiếp chữ/giá trị và đổi bảng màu.
 */
export function InfographicView({ content, onChange, readOnly = false, onEvidenceClick, className }: InfographicViewProps) {
  const t = useT();
  const { locale } = useLocale();
  const layout = useMemo(() => layoutInfographic(content, { locale }), [content, locale]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const editable = !readOnly && Boolean(onChange);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.1, el.clientWidth / layout.width));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.width]);

  const commit = (field: string, value: string) => {
    if (!onChange) return;
    // Xoá trắng một mục danh sách = bỏ mục đó.
    const m = /^(.*\.items)\.(\d+)$/.exec(field);
    if (m && value.trim() === "") {
      const idx = Number(m[2]);
      const items = (m[1].split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], content) as string[]).filter((_, i) => i !== idx);
      onChange(setAt(content, m[1], items));
      return;
    }
    onChange(setAt(content, field, value));
  };

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="infographic-view">
      {editable && (
        <div className="flex items-center gap-2" role="group" aria-label={t("infographic.palette")}>
          <span className="text-xs font-medium text-muted-foreground">{t("infographic.palette")}</span>
          {SLIDE_PALETTES.map((p) => (
            <button
              key={p}
              type="button"
              data-testid={`info-palette-${p}`}
              aria-pressed={content.palette === p}
              aria-label={t(`slides.palette.${p}` as const)}
              title={t(`slides.palette.${p}` as const)}
              onClick={() => onChange?.({ ...content, palette: p })}
              className={cn("flex size-7 items-center justify-center rounded-full border-2", content.palette === p ? "border-foreground" : "border-transparent")}
              style={{ background: PALETTES[p].primary }}
            >
              {content.palette === p && <Check className="size-4 text-white" aria-hidden />}
            </button>
          ))}
        </div>
      )}
      <div ref={wrapRef} className="w-full overflow-hidden rounded-lg border bg-muted/30">
        {editable && <style>{SLIDE_EDIT_CSS}</style>}
        <div style={{ width: layout.width * scale, height: layout.height * scale, position: "relative", margin: "0 auto" }}>
          <div
            className="kbm-slide"
            data-orientation={content.orientation}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: layout.width,
              height: layout.height,
              transform: `scale(${scale})`,
              transformOrigin: "0 0",
              background: layout.background,
              fontFamily: INFOGRAPHIC_FONT.css,
              overflow: "hidden",
            }}
          >
            {layout.prims.map((p) => (
              <PrimView key={p.key} p={p} ctx={{ editable, commit, onEvidenceClick }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
