import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourceCard, sourceSubtitle, type SourceCardActions } from "@/components/sources/source-card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { t } from "@/lib/i18n";
import {
  detectFileType,
  resolveHighlightRange,
  splitForHighlight,
  type SourceDto,
} from "@/lib/sources";
import { getSelectedSourceIds, isSelectionInitialized, useSourceSelection } from "@/lib/use-source-selection";

function source(over: Partial<SourceDto> = {}): SourceDto {
  return {
    id: "s1",
    notebookId: "nb",
    kind: "file",
    fileType: "pdf",
    title: "Giáo trình.pdf",
    mime: "application/pdf",
    url: null,
    fileId: "f1",
    visibility: "shared",
    status: "ready",
    progress: 100,
    error: null,
    pageCount: 12,
    pageUnit: "page",
    tokenCount: 3400,
    summary: null,
    keyTopics: null,
    createdBy: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    canManage: true,
    ...over,
  };
}

const actions = (): SourceCardActions => ({
  onView: vi.fn(),
  onRename: vi.fn(),
  onToggleVisibility: vi.fn(),
  onReprocess: vi.fn(),
  onDelete: vi.fn(),
});

function renderCard(s: SourceDto, opts: { selected?: boolean; canEdit?: boolean; a?: SourceCardActions; onSelected?: (v: boolean) => void } = {}) {
  const a = opts.a ?? actions();
  render(
    <TooltipProvider>
      <ul>
        <SourceCard source={s} selected={opts.selected ?? false} onSelectedChange={opts.onSelected ?? (() => {})} actions={a} canEdit={opts.canEdit ?? true} />
      </ul>
    </TooltipProvider>,
  );
  return a;
}

describe("SourceCard", () => {
  it("nguồn sẵn sàng: phụ đề trang · token, chọn được, mở viewer khi bấm tiêu đề", async () => {
    const onSelected = vi.fn();
    const a = renderCard(source(), { selected: true, onSelected });
    expect(screen.getByText("12 trang · ~3,4k token")).toBeInTheDocument();
    const box = screen.getByRole("checkbox", { name: /Giáo trình\.pdf/ });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(onSelected).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: "Giáo trình.pdf" }));
    expect(a.onView).toHaveBeenCalled();
  });

  it("đang xử lý: spinner + phần trăm + thanh tiến độ, không chọn được", () => {
    renderCard(source({ status: "processing", progress: 45, pageCount: null, tokenCount: null }), { selected: true });
    expect(screen.getByText("Đang xử lý… 45%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "45");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("chờ xử lý và lỗi", () => {
    const { unmount } = render(
      <TooltipProvider>
        <ul>
          <SourceCard source={source({ status: "pending", progress: 0 })} selected={false} onSelectedChange={() => {}} actions={actions()} canEdit />
        </ul>
      </TooltipProvider>,
    );
    expect(screen.getByText("Đang chờ xử lý")).toBeInTheDocument();
    unmount();
    renderCard(source({ status: "failed", error: "PDF không có lớp văn bản (cần OCR)" }));
    expect(screen.getByTestId("source-failed")).toHaveTextContent("PDF không có lớp văn bản (cần OCR)");
  });

  it("nguồn riêng tư hiện biểu tượng khoá", () => {
    renderCard(source({ visibility: "private" }));
    expect(screen.getByLabelText("Riêng tư")).toBeInTheDocument();
  });

  it("menu ⋯: đủ mục cho chủ nguồn; viewer/người không quản lý chỉ có 'Xem'", async () => {
    const a = renderCard(source());
    await userEvent.click(screen.getByRole("button", { name: "Tuỳ chọn nguồn" }));
    for (const name of ["Xem", "Đổi tên", "Chuyển sang riêng tư", "Xử lý lại", "Xoá"]) {
      expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole("menuitem", { name: "Chuyển sang riêng tư" }));
    expect(a.onToggleVisibility).toHaveBeenCalled();
  });

  it("không có quyền quản lý → chỉ 'Xem'; nguồn private đề nghị 'Chia sẻ với sổ tay'", async () => {
    renderCard(source({ canManage: false }));
    await userEvent.click(screen.getByRole("button", { name: "Tuỳ chọn nguồn" }));
    expect(screen.getByRole("menuitem", { name: "Xem" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Xoá" })).not.toBeInTheDocument();
  });

  it("sourceSubtitle theo đơn vị", () => {
    expect(sourceSubtitle(source({ pageUnit: "slide", pageCount: 20, tokenCount: null }), t)).toBe("20 slide");
    expect(sourceSubtitle(source({ kind: "url", fileType: null, pageCount: null, pageUnit: null, tokenCount: 900 }), t)).toBe("Liên kết · ~900 token");
  });
});

describe("useSourceSelection", () => {
  beforeEach(() => localStorage.clear());

  it("lưu theo từng sổ tay trong localStorage và dùng chung giữa các hook", () => {
    const a = renderHook(() => useSourceSelection("nb-a"));
    const a2 = renderHook(() => useSourceSelection("nb-a"));
    const b = renderHook(() => useSourceSelection("nb-b"));
    expect(isSelectionInitialized("nb-a")).toBe(false);
    act(() => a.result.current.setAll(["s1", "s2"]));
    expect(a.result.current.selectedIds).toEqual(["s1", "s2"]);
    expect(a2.result.current.selectedIds).toEqual(["s1", "s2"]); // đồng bộ
    expect(b.result.current.selectedIds).toEqual([]); // sổ tay khác không bị ảnh hưởng
    expect(JSON.parse(localStorage.getItem("kbm:sources:selected:nb-a")!)).toEqual(["s1", "s2"]);
    expect(isSelectionInitialized("nb-a")).toBe(true);
    expect(getSelectedSourceIds("nb-a")).toEqual(["s1", "s2"]);
  });

  it("toggle / add / prune / clear; tham chiếu mảng ổn định khi không đổi", () => {
    const { result } = renderHook(() => useSourceSelection("nb-c"));
    act(() => result.current.toggle("x"));
    act(() => result.current.add(["y", "x"]));
    expect(result.current.selectedIds).toEqual(["x", "y"]);
    expect(result.current.isSelected("y")).toBe(true);
    const before = result.current.selectedIds;
    act(() => result.current.prune(["x", "y", "z"]));
    expect(result.current.selectedIds).toBe(before);
    act(() => result.current.prune(["y"]));
    expect(result.current.selectedIds).toEqual(["y"]);
    act(() => result.current.toggle("y"));
    expect(result.current.selectedIds).toEqual([]);
    act(() => result.current.clear());
    expect(result.current.selectedIds).toEqual([]);
  });

  it("đọc lại lựa chọn đã lưu khi mount và bỏ qua dữ liệu hỏng", () => {
    localStorage.setItem("kbm:sources:selected:nb-d", JSON.stringify(["a", 3, "b"]));
    expect(renderHook(() => useSourceSelection("nb-d")).result.current.selectedIds).toEqual(["a", "b"]);
    localStorage.setItem("kbm:sources:selected:nb-e", "{hỏng");
    expect(renderHook(() => useSourceSelection("nb-e")).result.current.selectedIds).toEqual([]);
  });
});

describe("tiện ích viewer", () => {
  it("resolveHighlightRange: ưu tiên chunk, dự phòng start/end, rỗng thì null", () => {
    const chunks = [{ id: "c1", startChar: 10, endChar: 50 }];
    expect(resolveHighlightRange(chunks, { chunk: "c1", start: 0, end: 5 })).toEqual({ start: 10, end: 50 });
    expect(resolveHighlightRange(chunks, { chunk: "đã-đổi", start: 100, end: 140 })).toEqual({ start: 100, end: 140 });
    expect(resolveHighlightRange(chunks, { page: 3 })).toBeNull();
    expect(resolveHighlightRange(chunks, { start: 5, end: 5 })).toBeNull();
  });

  it("splitForHighlight cắt theo giao của khoảng với trang", () => {
    // trang bắt đầu ở 100, dài 10 ký tự
    expect(splitForHighlight("0123456789", 100, { start: 103, end: 106 })).toEqual({ before: "012", mark: "345", after: "6789" });
    expect(splitForHighlight("0123456789", 100, { start: 90, end: 104 })).toEqual({ before: "", mark: "0123", after: "456789" });
    expect(splitForHighlight("0123456789", 100, { start: 108, end: 200 })).toEqual({ before: "01234567", mark: "89", after: "" });
    expect(splitForHighlight("0123456789", 100, { start: 0, end: 50 })).toBeNull();
    expect(splitForHighlight("0123456789", 100, null)).toBeNull();
  });

  it("detectFileType: đuôi + MIME, chấp nhận octet-stream, từ chối mâu thuẫn", () => {
    expect(detectFileType("a.PDF", "application/pdf")).toBe("pdf");
    expect(detectFileType("a.docx", "")).toBe("docx");
    expect(detectFileType("a.md", "text/plain")).toBe("md");
    expect(detectFileType("a.csv", "application/vnd.ms-excel")).toBe("csv");
    expect(detectFileType("a.xls", "application/vnd.ms-excel")).toBe("xlsx");
    expect(detectFileType("a.pdf", "image/png")).toBeNull();
    expect(detectFileType("a.exe", "application/octet-stream")).toBeNull();
    expect(detectFileType("khong-duoi", "text/plain")).toBeNull();
  });
});
