import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownWithCitations } from "@/components/chat/markdown-with-citations";
import { AssistantMessage } from "@/components/chat/message-item";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Evidence } from "@/lib/chat";

const evidence: Evidence[] = [
  { id: "c1", provider: "local", sourceId: "s1", sourceTitle: "Giáo trình sinh học", locator: { page: 3, startChar: 10, endChar: 90 }, text: "Quang hợp diễn ra ở lục lạp. ".repeat(12), score: 0.03, similarity: 0.7 },
  { id: "c2", provider: "local", sourceId: "s2", sourceTitle: "Bài giảng", locator: { slide: 4 }, text: "Ty thể sinh ATP.", score: 0.02, similarity: 0.5 },
  { id: "w1", provider: "web", sourceId: null, sourceTitle: "Wikipedia", locator: { url: "https://vi.wikipedia.org/wiki/Quang_hop" }, text: "Quang hợp trên web.", score: 0.01 },
];

// Radix (Tooltip/Popper) cần ResizeObserver, jsdom không có.
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("MarkdownWithCitations", () => {
  it("render markdown GFM (bảng, danh sách, đậm) và chip [n] có thật", () => {
    wrap(
      <MarkdownWithCitations
        evidence={evidence}
        content={"**Kết luận** quang hợp ở lục lạp [1].\n\n- ý một [2]\n- ý hai\n\n| A | B |\n| - | - |\n| 1 | 2 |"}
      />,
    );
    expect(screen.getByText("Kết luận").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();
    const chips = screen.getAllByTestId("citation-chip");
    expect(chips.map((c) => c.textContent)).toEqual(["[1]", "[2]"]);
    expect(chips[0]).toHaveAttribute("aria-label", "Trích dẫn 1: Giáo trình sinh học");
  });

  it("[1, 3] và [2-3] thành nhiều chip; số không có trong bằng chứng bị ẩn", () => {
    wrap(<MarkdownWithCitations evidence={evidence} content="Hai nguồn [1, 3]. Khoảng [2-3]. Bịa [9]." />);
    expect(screen.getAllByTestId("citation-chip").map((c) => c.textContent)).toEqual(["[1]", "[3]", "[2]", "[3]"]);
    expect(screen.queryByText(/\[9\]/)).not.toBeInTheDocument();
  });

  it("không đụng tới mã và liên kết markdown; không có danh sách bằng chứng thì giữ nguyên chữ", () => {
    wrap(<MarkdownWithCitations evidence={evidence} content={"Mã `a[1]` và [1](https://example.com)\n\n```\nx[2]\n```"} />);
    expect(screen.queryAllByTestId("citation-chip")).toHaveLength(0);
    expect(screen.getByText("a[1]")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1" })).toHaveAttribute("href", "https://example.com");

    wrap(<MarkdownWithCitations content="Chưa có bằng chứng [1]." />);
    expect(screen.getByText("Chưa có bằng chứng [1].")).toBeInTheDocument();
  });

  it("hover chip → tooltip có tên nguồn, trang và trích đoạn ≤ 200 ký tự", async () => {
    const user = userEvent.setup();
    wrap(<MarkdownWithCitations evidence={evidence} content="Có ở lục lạp [1]." />);
    await user.hover(screen.getByTestId("citation-chip"));
    const tip = (await screen.findAllByTestId("citation-tooltip"))[0];
    expect(within(tip).getByText("Giáo trình sinh học")).toBeInTheDocument();
    expect(within(tip).getByText("trang 3")).toBeInTheDocument();
    const excerpt = within(tip).getByText(/^Quang hợp diễn ra ở lục lạp\./);
    expect(excerpt.textContent!.length).toBeLessThanOrEqual(201);
    expect(excerpt.textContent!.endsWith("…")).toBe(true);
  });

  it("bấm chip nguồn cục bộ → onCitationOpen; chip web → mở URL ở tab mới", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const winOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    wrap(<MarkdownWithCitations evidence={evidence} content="Cục bộ [2] và web [3]." onCitationOpen={open} />);
    const [local, web] = screen.getAllByTestId("citation-chip");
    await user.click(local);
    expect(open).toHaveBeenCalledWith(2, evidence[1]);
    await user.click(web);
    expect(open).toHaveBeenCalledTimes(1);
    expect(winOpen).toHaveBeenCalledWith("https://vi.wikipedia.org/wiki/Quang_hop", "_blank", "noopener,noreferrer");
    winOpen.mockRestore();
  });

  it("đang stream → có con trỏ nhấp nháy", () => {
    wrap(<MarkdownWithCitations content="Đang trả lời" streaming />);
    expect(screen.getByTestId("stream-caret")).toBeInTheDocument();
  });
});

describe("AssistantMessage", () => {
  const message = {
    id: "m1",
    content: "Quang hợp ở lục lạp [1]; ty thể [2].",
    citations: evidence,
    sourcesUsed: [
      { key: "local:s1", sourceId: "s1", provider: "local" as const, title: "Giáo trình sinh học", locators: ["trang 3"], numbers: [1] },
      { key: "local:s2", sourceId: "s2", provider: "local" as const, title: "Bài giảng", locators: ["slide 4"], numbers: [2] },
    ],
    insufficientEvidence: false,
    model: "mock-chat",
  };

  it("hiện 'Nguồn đã dùng', các nút hành động và gọi đúng callback", async () => {
    const user = userEvent.setup();
    const onSaveExchange = vi.fn().mockResolvedValue(undefined);
    const onSaveNote = vi.fn().mockResolvedValue(undefined);
    const onRegenerate = vi.fn();
    const onOpen = vi.fn();
    wrap(<AssistantMessage message={message} evidence={evidence} onCitationOpen={onOpen} actions={{ onSaveExchange, onSaveNote, onRegenerate }} />);

    const used = screen.getByTestId("sources-used");
    expect(within(used).getByText("Nguồn đã dùng")).toBeInTheDocument();
    expect(within(used).getAllByTestId("source-used")).toHaveLength(2);
    expect(within(used).getByText("trang 3")).toBeInTheDocument();
    await user.click(within(used).getAllByTestId("source-used")[1]);
    expect(onOpen).toHaveBeenCalledWith(2, evidence[1]);

    await user.click(screen.getByRole("button", { name: /Lưu thành ghi chú/ }));
    expect(onSaveNote).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: /Lưu cặp hỏi-đáp/ }));
    expect(onSaveExchange).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: /Tạo lại/ }));
    expect(onRegenerate).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /Sao chép/ })).toBeInTheDocument();
    expect(screen.queryByTestId("insufficient-banner")).not.toBeInTheDocument();
  });

  it("insufficientEvidence → banner cảnh báo; viewer (không có onSaveNote) không thấy nút lưu ghi chú", () => {
    wrap(
      <AssistantMessage
        message={{ ...message, insufficientEvidence: true, sourcesUsed: [] }}
        evidence={evidence}
        onCitationOpen={vi.fn()}
        actions={{ onSaveExchange: vi.fn() }}
      />,
    );
    expect(screen.getByTestId("insufficient-banner")).toHaveTextContent("Không đủ bằng chứng");
    expect(screen.queryByTestId("sources-used")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lưu thành ghi chú/ })).not.toBeInTheDocument();
  });

  it("đang stream → chưa có hành động; chưa có chữ → 'Đang tìm trong nguồn…'", () => {
    wrap(<AssistantMessage message={{ ...message, content: "" }} evidence={[]} onCitationOpen={vi.fn()} searching actions={{ onSaveExchange: vi.fn() }} streaming={false} />);
    expect(screen.getByTestId("chat-searching")).toBeInTheDocument();
  });
});
