import { describe, expect, it } from "vitest";
import type { MindmapNode } from "@/lib/artifacts/content";
import { addChild, addSibling, countNodes, findNode, indentNode, moveNode, outdentNode, removeNode, updateNode } from "@/lib/artifacts/mindmap-tree";

const n = (id: string, children: MindmapNode[] = []): MindmapNode => ({ id, label: id.toUpperCase(), children });
const labels = (root: MindmapNode): string => `${root.id}(${root.children.map(labels).join(",")})`;

function sample(): MindmapNode {
  return n("r", [n("a", [n("a1"), n("a2")]), n("b"), n("c", [n("c1")])]);
}

describe("mindmap-tree", () => {
  it("updateNode: đổi nhãn/ghi chú, xoá ghi chú rỗng, không đụng cây gốc (bất biến)", () => {
    const root = sample();
    const next = updateNode(root, "a1", { label: "Mới", note: "ghi chú" });
    expect(findNode(next, "a1")!.node).toMatchObject({ label: "Mới", note: "ghi chú" });
    expect(findNode(root, "a1")!.node.label).toBe("A1");
    expect(findNode(updateNode(next, "a1", { note: "" }), "a1")!.node).not.toHaveProperty("note");
    expect(next.children[1]).toBe(root.children[1]); // nhánh không đổi dùng chung tham chiếu
  });

  it("addChild / addSibling trả id mới; anh em chèn ngay sau; gốc không có anh em → thành con", () => {
    const root = sample();
    const c = addChild(root, "b", "con của b");
    expect(findNode(c.root, c.id)!.parent!.id).toBe("b");
    const s = addSibling(root, "a", "sau a");
    expect(s.root.children.map((x) => x.id)).toEqual(["a", s.id, "b", "c"]);
    const onRoot = addSibling(root, "r");
    expect(findNode(onRoot.root, onRoot.id)!.parent!.id).toBe("r");
  });

  it("removeNode xoá cả nhánh con, không xoá được gốc", () => {
    const root = sample();
    expect(labels(removeNode(root, "a"))).toBe("r(b(),c(c1()))");
    expect(removeNode(root, "r")).toBe(root);
  });

  it("indent: thành con cuối của anh em phía trên; nút đầu tiên không lùi vào được", () => {
    const root = sample();
    expect(labels(indentNode(root, "b"))).toBe("r(a(a1(),a2(),b()),c(c1()))");
    expect(indentNode(root, "a")).toBe(root);
  });

  it("outdent: thành anh em ngay sau cha; con của gốc không ra ngoài được", () => {
    const root = sample();
    expect(labels(outdentNode(root, "a1"))).toBe("r(a(a2()),a1(),b(),c(c1()))");
    expect(outdentNode(root, "a")).toBe(root);
  });

  it("moveNode đổi chỗ với anh em và dừng ở biên", () => {
    const root = sample();
    expect(labels(moveNode(root, "b", -1))).toBe("r(b(),a(a1(),a2()),c(c1()))");
    expect(moveNode(root, "a", -1)).toBe(root);
    expect(moveNode(root, "c", 1)).toBe(root);
    expect(countNodes(root)).toBe(7);
  });
});
