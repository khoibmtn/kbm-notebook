import "server-only";
import { CitationRemapper } from "@/lib/artifacts/citations";
import { mindmapContentSchema, newItemId, type MindmapContent, type MindmapNode } from "@/lib/artifacts/content";
import { CITATION_RULES } from "../prompt";
import { mindmapOutputSchema, type MindmapOutput } from "../schemas";
import { ArtifactGenerationError, generateJson, withContextBlock, type GeneratedArtifact, type GeneratorInput } from "./common";

const FORMAT_RULES = `Định dạng đầu ra: JSON {"title", "nodes": [{"id", "parentId", "label", "note"?, "citations"?}]}.
- Danh sách phẳng: đúng một nút gốc có "parentId": null; mọi nút khác trỏ "parentId" tới "id" của nút cha.
- "label" ngắn (≤ 6 từ); "note" là chú thích ngắn nếu cần; "citations" là số nguồn [n].`;

export type RawNode = { label: string; note?: string; rawCitations: number[]; children: RawNode[] };

/**
 * Dựng cây từ danh sách phẳng. Nhiều nút gốc → nút gốc đầu tiên giữ nguyên, các gốc còn lại gắn vào nó;
 * nút có cha không tồn tại gắn vào gốc; nút nằm trong chu trình (không với tới được từ gốc) bị loại.
 * `maxDepth` cắt các cấp sâu hơn (không tính gốc).
 */
export function buildMindmapTree(nodes: MindmapOutput["nodes"], maxDepth?: number): RawNode {
  const byId = new Map<string, MindmapOutput["nodes"][number]>();
  for (const n of nodes) if (n.label.trim() && !byId.has(n.id)) byId.set(n.id, n);
  const roots = [...byId.values()].filter((n) => n.parentId === null || !byId.has(n.parentId));
  const declaredRoot = [...byId.values()].find((n) => n.parentId === null) ?? roots[0];
  if (!declaredRoot) throw new ArtifactGenerationError("Sơ đồ tư duy không có nút gốc");
  const children = new Map<string, string[]>();
  for (const n of byId.values()) {
    if (n.id === declaredRoot.id) continue;
    const parent = n.parentId !== null && byId.has(n.parentId) && n.parentId !== n.id ? n.parentId : declaredRoot.id;
    const list = children.get(parent) ?? [];
    list.push(n.id);
    children.set(parent, list);
  }
  const visited = new Set<string>();
  const build = (id: string, depth: number): RawNode => {
    visited.add(id);
    const n = byId.get(id)!;
    const kids = depth >= (maxDepth ?? Infinity) ? [] : (children.get(id) ?? []).filter((c) => !visited.has(c));
    return {
      label: n.label.trim(),
      note: n.note?.trim() || undefined,
      rawCitations: n.citations ?? [],
      children: kids.map((c) => build(c, depth + 1)),
    };
  };
  return build(declaredRoot.id, 0);
}

export async function generateMindmap(input: GeneratorInput): Promise<GeneratedArtifact> {
  const out = await generateJson(input, {
    type: "mindmap",
    schema: mindmapOutputSchema,
    system: `${CITATION_RULES}\n${FORMAT_RULES}`,
    user: withContextBlock(input.instructions, input.contextText),
  });
  const depth = typeof input.options.depth === "number" ? input.options.depth : undefined;
  const tree = buildMindmapTree(out.nodes, depth);
  if (tree.children.length === 0) throw new ArtifactGenerationError("Sơ đồ tư duy không có nhánh nào");
  const remap = new CitationRemapper(input.evidence);
  const convert = (n: RawNode): MindmapNode => {
    const citations = remap.list(n.rawCitations);
    return {
      id: newItemId("m"),
      label: remap.markdown(n.label).trim() || n.label,
      ...(n.note ? { note: remap.markdown(n.note) } : {}),
      ...(citations ? { citations } : {}),
      children: n.children.map(convert),
    };
  };
  const root = convert(tree);
  const content: MindmapContent = mindmapContentSchema.parse({ root, evidence: remap.used });
  return { content, title: out.title.trim() || undefined };
}
