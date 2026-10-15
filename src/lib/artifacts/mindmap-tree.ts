/** Thao tác thuần (bất biến) trên cây sơ đồ tư duy — dùng cho trình sửa đề cương. */
import { newItemId, type MindmapNode } from "./content";

type Located = { node: MindmapNode; parent: MindmapNode | null; index: number };

export function findNode(root: MindmapNode, id: string, parent: MindmapNode | null = null, index = 0): Located | null {
  if (root.id === id) return { node: root, parent, index };
  for (let i = 0; i < root.children.length; i++) {
    const hit = findNode(root.children[i], id, root, i);
    if (hit) return hit;
  }
  return null;
}

/** Áp `fn` lên node `id`; trả cây mới (node/ancestors được sao chép, phần còn lại dùng chung). */
function mapNode(root: MindmapNode, id: string, fn: (n: MindmapNode) => MindmapNode): MindmapNode {
  if (root.id === id) return fn(root);
  let changed = false;
  const children = root.children.map((c) => {
    const n = mapNode(c, id, fn);
    if (n !== c) changed = true;
    return n;
  });
  return changed ? { ...root, children } : root;
}

export function updateNode(root: MindmapNode, id: string, patch: Partial<Pick<MindmapNode, "label" | "note">>): MindmapNode {
  return mapNode(root, id, (n) => {
    const next = { ...n, ...patch };
    if (!next.note) delete next.note;
    return next;
  });
}

export function addChild(root: MindmapNode, parentId: string, label = ""): { root: MindmapNode; id: string } {
  const id = newItemId("m");
  return { root: mapNode(root, parentId, (n) => ({ ...n, children: [...n.children, { id, label, children: [] }] })), id };
}

export function addSibling(root: MindmapNode, id: string, label = ""): { root: MindmapNode; id: string } {
  const loc = findNode(root, id);
  if (!loc?.parent) return addChild(root, root.id, label); // gốc không có anh em → thêm con
  const newId = newItemId("m");
  const next = mapNode(root, loc.parent.id, (p) => {
    const children = [...p.children];
    children.splice(loc.index + 1, 0, { id: newId, label, children: [] });
    return { ...p, children };
  });
  return { root: next, id: newId };
}

/** Xoá node (không xoá được gốc). */
export function removeNode(root: MindmapNode, id: string): MindmapNode {
  const loc = findNode(root, id);
  if (!loc?.parent) return root;
  return mapNode(root, loc.parent.id, (p) => ({ ...p, children: p.children.filter((c) => c.id !== id) }));
}

/** Lùi vào: node trở thành con cuối của anh em đứng ngay trước nó. */
export function indentNode(root: MindmapNode, id: string): MindmapNode {
  const loc = findNode(root, id);
  if (!loc?.parent || loc.index === 0) return root;
  const prev = loc.parent.children[loc.index - 1];
  const without = removeNode(root, id);
  return mapNode(without, prev.id, (n) => ({ ...n, children: [...n.children, loc.node] }));
}

/** Ra ngoài: node trở thành anh em ngay sau cha của nó. */
export function outdentNode(root: MindmapNode, id: string): MindmapNode {
  const loc = findNode(root, id);
  if (!loc?.parent) return root;
  const grand = findNode(root, loc.parent.id);
  if (!grand?.parent) return root; // cha là gốc → không thể ra ngoài nữa
  const without = removeNode(root, id);
  return mapNode(without, grand.parent.id, (g) => {
    const children = [...g.children];
    const at = children.findIndex((c) => c.id === loc.parent!.id);
    children.splice(at + 1, 0, loc.node);
    return { ...g, children };
  });
}

export function moveNode(root: MindmapNode, id: string, dir: -1 | 1): MindmapNode {
  const loc = findNode(root, id);
  if (!loc?.parent) return root;
  const j = loc.index + dir;
  if (j < 0 || j >= loc.parent.children.length) return root;
  return mapNode(root, loc.parent.id, (p) => {
    const children = [...p.children];
    [children[loc.index], children[j]] = [children[j], children[loc.index]];
    return { ...p, children };
  });
}

export function countNodes(root: MindmapNode): number {
  return 1 + root.children.reduce((s, c) => s + countNodes(c), 0);
}
