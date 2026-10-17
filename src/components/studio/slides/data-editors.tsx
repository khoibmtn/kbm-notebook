"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale, useT } from "@/lib/i18n-client";
import {
  addChartRow,
  addChartSeries,
  addTableColumn,
  addTableRow,
  defaultLabels,
  removeChartRow,
  removeChartSeries,
  removeTableColumn,
  removeTableRow,
  setChartCell,
} from "@/server/artifacts/slides/ops";
import type { Slide, SlideChart } from "@/server/artifacts/slides/types";

/** Ô nhập chuỗi với bản nháp cục bộ; chỉ xác nhận khi mất focus để mỗi lần sửa là một bước undo. */
function DraftInput({
  value,
  onCommit,
  className,
  label,
  inputMode,
  testId,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  label: string;
  inputMode?: "decimal" | "text";
  testId?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <Input
      value={draft}
      aria-label={label}
      inputMode={inputMode}
      data-testid={testId}
      className={className}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

function parseNum(s: string): number | null {
  const n = Number(s.replace(",", ".").trim());
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
}

const CELL = "h-8 min-w-0 px-2 text-xs";

export function ChartEditor({ chart, onChange }: { chart: SlideChart; onChange: (c: SlideChart) => void }) {
  const t = useT();
  const d = defaultLabels(useLocale().locale);
  return (
    <div className="space-y-3" data-testid="chart-editor">
      <div className="flex items-center gap-2">
        <Select value={chart.type} onValueChange={(v) => onChange({ ...chart, type: v as SlideChart["type"], series: v === "pie" ? chart.series.slice(0, 1) : chart.series })}>
          <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("slides.chart.type")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bar">{t("slides.chart.bar")}</SelectItem>
            <SelectItem value="line">{t("slides.chart.line")}</SelectItem>
            <SelectItem value="pie">{t("slides.chart.pie")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="w-24 text-left font-medium text-muted-foreground">{t("slides.chart.label")}</th>
              {chart.series.map((s, si) => (
                <th key={si} className="min-w-20">
                  <div className="flex items-center gap-0.5">
                    <DraftInput
                      value={s.name}
                      label={t("slides.chart.series")}
                      className={CELL}
                      onCommit={(v) => onChange({ ...chart, series: chart.series.map((x, i) => (i === si ? { ...x, name: v } : x)) })}
                    />
                    {chart.type !== "pie" && chart.series.length > 1 && (
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={t("slides.chart.removeSeries")} onClick={() => onChange(removeChartSeries(chart, si))}>
                        <X />
                      </Button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {chart.labels.map((label, li) => (
              <tr key={li}>
                <td>
                  <DraftInput
                    value={label}
                    label={t("slides.chart.label")}
                    className={CELL}
                    onCommit={(v) => onChange({ ...chart, labels: chart.labels.map((x, i) => (i === li ? v : x)) })}
                  />
                </td>
                {chart.series.map((s, si) => (
                  <td key={si}>
                    <DraftInput
                      value={String(s.values[li] ?? 0)}
                      inputMode="decimal"
                      label={`${s.name} / ${label}`}
                      testId={`chart-cell-${si}-${li}`}
                      className={CELL}
                      onCommit={(v) => {
                        const n = parseNum(v);
                        if (n !== null) onChange(setChartCell(chart, si, li, n));
                      }}
                    />
                  </td>
                ))}
                <td>
                  {chart.labels.length > 1 && (
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={t("slides.chart.removeRow")} onClick={() => onChange(removeChartRow(chart, li))}>
                      <X />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="xs" onClick={() => onChange(addChartRow(chart, d))}>
          <Plus /> {t("slides.chart.addRow")}
        </Button>
        {chart.type !== "pie" && (
          <Button type="button" variant="outline" size="xs" onClick={() => onChange(addChartSeries(chart, d))}>
            <Plus /> {t("slides.chart.addSeries")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function TableEditor({ table, onChange }: { table: NonNullable<Slide["table"]>; onChange: (t: NonNullable<Slide["table"]>) => void }) {
  const t = useT();
  const d = defaultLabels(useLocale().locale);
  return (
    <div className="space-y-3" data-testid="table-editor">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              {table.headers.map((h, ci) => (
                <th key={ci} className="min-w-24">
                  <div className="flex items-center gap-0.5">
                    <DraftInput
                      value={h}
                      label={t("slides.table.header")}
                      className={`${CELL} font-semibold`}
                      onCommit={(v) => onChange({ ...table, headers: table.headers.map((x, i) => (i === ci ? v : x)) })}
                    />
                    {table.headers.length > 1 && (
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={t("slides.table.removeColumn")} onClick={() => onChange(removeTableColumn(table, ci))}>
                        <X />
                      </Button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={ri}>
                {table.headers.map((_, ci) => (
                  <td key={ci}>
                    <DraftInput
                      value={row[ci] ?? ""}
                      label={`${table.headers[ci]} #${ri + 1}`}
                      className={CELL}
                      onCommit={(v) =>
                        onChange({
                          ...table,
                          rows: table.rows.map((r, i) => (i === ri ? table.headers.map((__, c) => (c === ci ? v : (r[c] ?? ""))) : r)),
                        })
                      }
                    />
                  </td>
                ))}
                <td>
                  {table.rows.length > 1 && (
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={t("slides.table.removeRow")} onClick={() => onChange(removeTableRow(table, ri))}>
                      <X />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="xs" onClick={() => onChange(addTableRow(table))}>
          <Plus /> {t("slides.table.addRow")}
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={() => onChange(addTableColumn(table, d))}>
          <Plus /> {t("slides.table.addColumn")}
        </Button>
      </div>
    </div>
  );
}
