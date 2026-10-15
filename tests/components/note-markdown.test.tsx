import { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { noteExtensions } from "@/components/notes/editor-extensions";
import { normalizeEditorMarkdown, unescapeCitationBrackets } from "@/lib/markdown";

function roundTrip(md: string): string {
  const editor = new Editor({ extensions: noteExtensions(), content: md, contentType: "markdown" });
  const out = normalizeEditorMarkdown(editor.getMarkdown());
  editor.destroy();
  return out;
}

describe("trình soạn ghi chú: Markdown ⇄ ProseMirror", () => {
  it("giữ tiêu đề, in đậm/nghiêng, danh sách, liên kết", () => {
    const out = roundTrip("# Tiêu đề\n\nĐoạn **đậm** và *nghiêng* với [liên kết](https://example.com).\n\n- một\n- hai\n\n1. a\n2. b");
    expect(out).toContain("# Tiêu đề");
    expect(out).toContain("**đậm**");
    expect(out).toContain("*nghiêng*");
    expect(out).toContain("[liên kết](https://example.com)");
    expect(out).toMatch(/- một\n- hai/);
    expect(out).toMatch(/1\. a\n2\. b/);
  });

  it("giữ danh sách việc cần làm và trạng thái tick", () => {
    const out = roundTrip("- [ ] việc một\n- [x] việc hai");
    expect(out).toContain("- [ ] việc một");
    expect(out).toContain("- [x] việc hai");
  });

  it("giữ bảng GFM", () => {
    const out = roundTrip("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    expect(out).toMatch(/\|\s*A\s*\|\s*B\s*\|/);
    expect(out).toMatch(/\|\s*-+\s*\|\s*-+\s*\|/);
    expect(out).toMatch(/\|\s*1\s*\|\s*2\s*\|/);
  });

  it("giữ trích dẫn [n] và khối mã", () => {
    const out = roundTrip("Nội dung có trích dẫn [1] và [2].\n\n```\ncode\n```\n\n- [1] Nguồn A — trang 3");
    expect(out).toContain("[1]");
    expect(out).toContain("```");
    expect(out).toContain("- [1] Nguồn A — trang 3");
  });

  it("bỏ escape ngoặc trích dẫn nhưng giữ escape khác", () => {
    expect(unescapeCitationBrackets("a \\[1\\] b \\[2, 3\\] \\[4-6\\] \\[x\\]")).toBe("a [1] b [2, 3] [4-6] \\[x\\]");
  });
});
