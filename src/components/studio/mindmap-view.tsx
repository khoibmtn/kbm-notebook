"use client";
import { ArrowDown, ArrowUp, ChevronsLeft, ChevronsRight, Maximize2, MessageSquarePlus, Plus, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { Markmap } from "markmap-view";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MindmapContent, MindmapNode } from "@/lib/artifacts/content";
import { addChild, addSibling, indentNode, moveNode, outdentNode, removeNode, updateNode } from "@/lib/artifacts/mindmap-tree";
import { useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import { SourcesFooter } from "./sources-footer";

type Props = {
  content: MindmapContent;
  onChange?: (c: MindmapContent) => void;
  readOnly?: boolean;
  notebookId?: string;
};

type INode = { content: string; children: INode[]; payload?: Record<string, unknown> };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function toINode(n: MindmapNode): INode {
  const note = n.note ? ` <span style="opacity:.6;font-size:.85em">— ${esc(n.note)}</span>` : "";
  return { content: `${esc(n.label || "…")}${note}`, children: n.children.map(toINode) };
}

function MindmapCanvas({ root }: { root: MindmapNode }) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<Markmap | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const mm = Markmap.create(svg, { duration: 250, maxWidth: 260, autoFit: true, initialExpandLevel: -1 }, toINode(root));
    mmRef.current = mm;
    return () => {
      mm.destroy();
      mmRef.current = null;
    };
    // chỉ tạo một lần; dữ liệu cập nhật ở effect bên dưới
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mm = mmRef.current;
    if (!mm) return;
    void mm.setData(toINode(root)).then(() => mm.fit());
  }, [root]);

  return (
    <div className="relative h-[60vh] min-h-96 overflow-hidden rounded-xl border bg-background" data-testid="mindmap-canvas">
      <svg
        ref={svgRef}
        className="size-full"
        role="img"
        aria-label={t("studio.mindmap.canvasLabel")}
        style={{ ["--markmap-text-color" as string]: "var(--foreground)", ["--markmap-circle-open-bg" as string]: "var(--background)" }}
      />
      <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border bg-background/90 p-1 shadow-sm">
        <Button size="icon-sm" variant="ghost" onClick={() => void mmRef.current?.rescale(1.25)} aria-label={t("studio.mindmap.zoomIn")}>
          <ZoomIn />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => void mmRef.current?.rescale(0.8)} aria-label={t("studio.mindmap.zoomOut")}>
          <ZoomOut />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => void mmRef.current?.fit()} aria-label={t("studio.mindmap.fit")}>
          <Maximize2 />
        </Button>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-3 text-xs text-muted-foreground">{t("studio.mindmap.hint")}</p>
    </div>
  );
}

function OutlineRow({
  node,
  depth,
  isRoot,
  apply,
  focusId,
}: {
  node: MindmapNode;
  depth: number;
  isRoot: boolean;
  apply: (fn: (root: MindmapNode) => { root: MindmapNode; id?: string } | MindmapNode) => void;
  focusId: string | null;
}) {
  const t = useT();
  const [showNote, setShowNote] = useState(Boolean(node.note));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusId === node.id) inputRef.current?.focus();
  }, [focusId, node.id]);
  return (
    <li>
      <div className="group flex items-center gap-1 py-0.5" style={{ paddingLeft: depth * 20 }} data-testid="outline-row">
        <Input
          ref={inputRef}
          value={node.label}
          onChange={(e) => apply((r) => updateNode(r, node.id, { label: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply((r) => (isRoot ? addChild(r, node.id) : addSibling(r, node.id)));
            } else if (e.key === "Tab") {
              e.preventDefault();
              apply((r) => (e.shiftKey ? outdentNode(r, node.id) : indentNode(r, node.id)));
            }
          }}
          className={cn("h-8 max-w-md", isRoot && "font-semibold")}
          aria-label={t("studio.mindmap.nodeLabel")}
          placeholder={t("studio.mindmap.nodePlaceholder")}
        />
        <div className="flex items-center gap-0.5 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Button size="icon-xs" variant="ghost" onClick={() => apply((r) => addChild(r, node.id))} aria-label={t("studio.mindmap.addChild")} title={t("studio.mindmap.addChild")}>
            <Plus />
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={() => setShowNote((v) => !v)} aria-label={t("studio.mindmap.toggleNote")} title={t("studio.mindmap.toggleNote")}>
            <MessageSquarePlus />
          </Button>
          {!isRoot && (
            <>
              <Button size="icon-xs" variant="ghost" onClick={() => apply((r) => outdentNode(r, node.id))} aria-label={t("studio.mindmap.outdent")} title={t("studio.mindmap.outdent")}>
                <ChevronsLeft />
              </Button>
              <Button size="icon-xs" variant="ghost" onClick={() => apply((r) => indentNode(r, node.id))} aria-label={t("studio.mindmap.indent")} title={t("studio.mindmap.indent")}>
                <ChevronsRight />
              </Button>
              <Button size="icon-xs" variant="ghost" onClick={() => apply((r) => moveNode(r, node.id, -1))} aria-label={t("studio.edit.moveUp")}>
                <ArrowUp />
              </Button>
              <Button size="icon-xs" variant="ghost" onClick={() => apply((r) => moveNode(r, node.id, 1))} aria-label={t("studio.edit.moveDown")}>
                <ArrowDown />
              </Button>
              <Button size="icon-xs" variant="ghost" onClick={() => apply((r) => removeNode(r, node.id))} aria-label={t("studio.mindmap.removeNode")} title={t("studio.mindmap.removeNode")}>
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </div>
      {showNote && (
        <div style={{ paddingLeft: depth * 20 + 8 }} className="pb-1">
          <Input
            value={node.note ?? ""}
            onChange={(e) => apply((r) => updateNode(r, node.id, { note: e.target.value }))}
            className="h-7 max-w-md text-xs"
            placeholder={t("studio.mindmap.notePlaceholder")}
            aria-label={t("studio.mindmap.notePlaceholder")}
          />
        </div>
      )}
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <OutlineRow key={c.id} node={c} depth={depth + 1} isRoot={false} apply={apply} focusId={focusId} />
          ))}
        </ul>
      )}
    </li>
  );
}

function OutlineEditor({ content, onChange }: { content: MindmapContent; onChange: (c: MindmapContent) => void }) {
  const t = useT();
  const [focusId, setFocusId] = useState<string | null>(null);
  const apply = (fn: (root: MindmapNode) => { root: MindmapNode; id?: string } | MindmapNode) => {
    const out = fn(content.root);
    const next: { root: MindmapNode; id?: string } = "root" in out ? out : { root: out };
    setFocusId(next.id ?? null);
    onChange({ ...content, root: next.root });
  };
  return (
    <div className="space-y-3" data-testid="mindmap-outline">
      <p className="text-sm text-muted-foreground">{t("studio.mindmap.outlineHint")}</p>
      <ul>
        <OutlineRow node={content.root} depth={0} isRoot apply={apply} focusId={focusId} />
      </ul>
    </div>
  );
}

/** Sơ đồ tư duy: vẽ bằng markmap (zoom/kéo), tab "Đề cương" để sửa cây lồng nhau. */
export function MindmapView({ content, onChange, readOnly, notebookId }: Props) {
  const t = useT();
  const [mode, setMode] = useState<"map" | "outline">("map");
  const canEdit = !readOnly && Boolean(onChange);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      {canEdit && (
        <div className="inline-flex rounded-lg border p-0.5" role="tablist" aria-label={t("studio.quiz.mode")}>
          {(["map", "outline"] as const).map((m) => (
            <Button key={m} role="tab" aria-selected={mode === m} size="sm" variant={mode === m ? "secondary" : "ghost"} onClick={() => setMode(m)} data-testid={`mindmap-mode-${m}`}>
              {t(m === "map" ? "studio.mindmap.modeMap" : "studio.mindmap.modeOutline")}
            </Button>
          ))}
        </div>
      )}
      {mode === "map" || !canEdit ? <MindmapCanvas root={content.root} /> : <OutlineEditor content={content} onChange={onChange!} />}
      <SourcesFooter evidence={content.evidence} notebookId={notebookId} />
    </div>
  );
}
