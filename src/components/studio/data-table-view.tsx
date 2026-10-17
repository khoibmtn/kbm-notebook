"use client";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DataTableContent } from "@/lib/artifacts/content";
import { useT } from "@/lib/i18n-client";
import { CitationList } from "./citation-chip";
import { SourcesFooter } from "./sources-footer";

type Props = {
  content: DataTableContent;
  onChange?: (c: DataTableContent) => void;
  readOnly?: boolean;
  notebookId?: string;
};

/** Khoá cột duy nhất cho cột mới. */
function newColumnKey(content: DataTableContent): string {
  const used = new Set(content.columns.map((c) => c.key));
  for (let i = content.columns.length + 1; ; i++) if (!used.has(`cot_${i}`)) return `cot_${i}`;
}

/** Bảng dữ liệu: lưới sửa được (thêm/xoá dòng và cột, sửa ô và tiêu đề cột); chỉ đọc cho người xem. */
export function DataTableView({ content, onChange, readOnly, notebookId }: Props) {
  const t = useT();
  const editable = !readOnly && Boolean(onChange);
  const set = (next: Partial<DataTableContent>) => onChange?.({ ...content, ...next });

  const setCell = (row: number, key: string, value: string) =>
    set({ rows: content.rows.map((r, i) => (i === row ? { ...r, cells: { ...r.cells, [key]: value } } : r)) });
  const addRow = () => set({ rows: [...content.rows, { cells: Object.fromEntries(content.columns.map((c) => [c.key, ""])) }] });
  const addColumn = () => {
    const key = newColumnKey(content);
    set({
      columns: [...content.columns, { key, label: t("studio.table.newColumn", { n: content.columns.length + 1 }) }],
      rows: content.rows.map((r) => ({ ...r, cells: { ...r.cells, [key]: "" } })),
    });
  };
  const removeColumn = (key: string) =>
    set({
      columns: content.columns.filter((c) => c.key !== key),
      rows: content.rows.map((r) => {
        const cells = { ...r.cells };
        delete cells[key];
        return { ...r, cells };
      }),
    });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-3" data-testid="data-table">
      <div className="overflow-auto rounded-xl border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="w-10 border-b border-r px-2 py-2 text-center text-xs font-medium text-muted-foreground">#</th>
              {content.columns.map((c, ci) => (
                <th key={c.key} className="min-w-40 border-b border-r p-1 text-left">
                  {editable ? (
                    <div className="flex items-center gap-1">
                      <Input
                        value={c.label}
                        onChange={(e) => set({ columns: content.columns.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)) })}
                        className="h-8 font-medium"
                        aria-label={t("studio.table.columnHeader", { n: ci + 1 })}
                      />
                      <Button size="icon-xs" variant="ghost" disabled={content.columns.length <= 1} onClick={() => removeColumn(c.key)} aria-label={t("studio.table.removeColumn", { name: c.label })}>
                        <Trash2 />
                      </Button>
                    </div>
                  ) : (
                    <span className="px-2 font-medium">{c.label}</span>
                  )}
                </th>
              ))}
              <th className="min-w-16 border-b px-2 text-left text-xs font-medium text-muted-foreground">{t("studio.table.sources")}</th>
              {editable && <th className="w-10 border-b" />}
            </tr>
          </thead>
          <tbody>
            {content.rows.map((r, ri) => (
              <tr key={ri} className="border-b last:border-0 hover:bg-accent/20" data-testid="data-table-row">
                <td className="border-r px-2 text-center text-xs text-muted-foreground">{ri + 1}</td>
                {content.columns.map((c) => (
                  <td key={c.key} className="border-r p-1 align-top">
                    {editable ? (
                      <Input
                        value={r.cells[c.key] ?? ""}
                        onChange={(e) => setCell(ri, c.key, e.target.value)}
                        className="h-8"
                        aria-label={`${c.label} ${ri + 1}`}
                      />
                    ) : (
                      <span className="block whitespace-pre-wrap px-2 py-1">{r.cells[c.key] ?? ""}</span>
                    )}
                  </td>
                ))}
                <td className="px-2 align-middle">
                  <CitationList citations={r.citations} evidence={content.evidence} notebookId={notebookId} />
                </td>
                {editable && (
                  <td className="px-1 text-center">
                    <Button size="icon-xs" variant="ghost" onClick={() => set({ rows: content.rows.filter((_, i) => i !== ri) })} aria-label={t("studio.table.removeRow", { n: ri + 1 })}>
                      <Trash2 />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {content.rows.length === 0 && (
              <tr>
                <td colSpan={content.columns.length + 3} className="p-6 text-center text-sm text-muted-foreground">
                  {t("studio.table.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={addRow} data-testid="table-add-row">
            <Plus /> {t("studio.table.addRow")}
          </Button>
          <Button variant="outline" onClick={addColumn} data-testid="table-add-column">
            <Plus /> {t("studio.table.addColumn")}
          </Button>
        </div>
      )}
      <SourcesFooter evidence={content.evidence} notebookId={notebookId} />
    </div>
  );
}
