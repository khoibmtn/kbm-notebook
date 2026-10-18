import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "@/components/chat/chat-panel";
import { MarkdownWithCitations } from "@/components/chat/markdown-with-citations";
import { AssistantMessage, SendErrorNotice } from "@/components/chat/message-item";
import { NotebookProvider } from "@/components/notebook/notebook-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiClientError } from "@/lib/api-client";
import type { AskStreamEvent, ChatMessageDto, Evidence } from "@/lib/chat";
import type { AskBody } from "@/lib/chat-stream";

const mocks = vi.hoisted(() => ({ api: vi.fn(), askStream: vi.fn() }));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...mod, api: mocks.api };
});
vi.mock("@/lib/chat-stream", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/chat-stream")>();
  return { ...mod, askStream: mocks.askStream };
});
vi.mock("@/lib/realtime", () => ({
  useRealtime: () => ({ connected: false }),
  useRealtimeEvent: () => undefined,
}));

const evidence: Evidence[] = [
  { id: "c1", provider: "local", sourceId: "s1", sourceTitle: "Giáo trình sinh học", locator: { page: 3, startChar: 10, endChar: 90 }, text: "Quang hợp diễn ra ở lục lạp. ".repeat(12), score: 0.03, similarity: 0.7 },
  { id: "c2", provider: "local", sourceId: "s2", sourceTitle: "Bài giảng", locator: { slide: 4 }, text: "Ty thể sinh ATP.", score: 0.02, similarity: 0.5 },
  { id: "w1", provider: "web", sourceId: null, sourceTitle: "Wikipedia", locator: { url: "https://vi.wikipedia.org/wiki/Quang_hop" }, text: "Quang hợp trên web.", score: 0.01 },
];

// Radix (Tooltip/Popper) cần ResizeObserver, jsdom không có.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn(); // jsdom không có; ChatPanel tự cuộn xuống cuối
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

describe("SendErrorNotice", () => {
  it("role=alert hiện thông điệp lỗi nguyên văn; 'Thử lại' gọi onRetry và bị khoá khi busy", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<SendErrorNotice message="Hết hạn mức AI (429)" onRetry={onRetry} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-testid", "chat-send-error");
    expect(alert).toHaveTextContent("Hết hạn mức AI (429)");
    await userEvent.click(screen.getByTestId("chat-retry"));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByTestId("chat-retry")).toHaveTextContent("Thử lại");
    rerender(<SendErrorNotice message="x" onRetry={onRetry} busy />);
    expect(screen.getByTestId("chat-retry")).toBeDisabled();
  });
});

describe("ChatPanel: dấu lỗi gửi câu hỏi + Thử lại", () => {
  const ctx = {
    role: "owner" as const,
    user: { id: "u1", name: "An", email: "an@x.com" },
    notebook: { id: "nb1", title: "Sổ tay", description: null, emoji: null, coverColor: null, systemInstruction: null, allowWeb: false, defaultArtifactVisibility: "notebook" as const, ownerId: "u1" },
  };
  const readySource = {
    id: "s1", notebookId: "nb1", kind: "text", fileType: null, title: "Nguồn 1", mime: null, url: null, fileId: null, visibility: "shared",
    status: "ready", progress: 100, error: null, pageCount: null, pageUnit: null, tokenCount: null, summary: null, keyTopics: null,
    createdBy: "u1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", canManage: true,
  };
  const msg = (id: string, role: "user" | "assistant", content: string): ChatMessageDto => ({
    id, conversationId: "c1", role, content, citations: null, sourcesUsed: null, insufficientEvidence: false, insufficientReason: null,
    scope: null, model: null, usage: null, createdAt: "2026-01-01T00:00:00.000Z",
  });
  let serverMessages: ChatMessageDto[] = [];

  async function* events(list: AskStreamEvent[]): AsyncGenerator<AskStreamEvent> {
    for (const ev of list) yield ev;
  }
  const meta = (userMessageId: string): AskStreamEvent => ({ type: "meta", messageId: "a1", userMessageId, evidence: [], scope: { useWeb: false } });
  const done = (): AskStreamEvent => ({
    type: "done", messageId: "a1", content: "Trả lời", citations: [], sourcesUsed: [], insufficientEvidence: false, insufficientReason: null, usage: null, model: null,
  });
  const bodyOf = (call: number) => mocks.askStream.mock.calls[call][2] as AskBody;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("kbm:sources:selected:nb1", JSON.stringify(["s1"]));
    serverMessages = [];
    mocks.api.mockReset();
    mocks.askStream.mockReset();
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/chat/models") return { default: "m1", models: ["m1"] };
      if (path === "/api/notebooks/nb1/sources") return { sources: [readySource] };
      if (path === "/api/notebooks/nb1/connections") return { connections: [] };
      if (path === "/api/notebooks/nb1/conversations") return { conversations: [{ id: "c1", notebookId: "nb1", title: "Hội thoại", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] };
      if (path === "/api/notebooks/nb1/conversations/c1") return { messages: serverMessages };
      throw new Error(`api không mong đợi: ${path}`);
    });
  });

  async function renderPanel() {
    wrap(
      <NotebookProvider value={ctx}>
        <ChatPanel />
      </NotebookProvider>,
    );
    // chờ danh sách nguồn tải xong: phạm vi (sourceIds) chỉ có khi nguồn đã chọn là nguồn sẵn sàng
    await waitFor(() => expect(screen.getByTestId("scope-button")).toHaveTextContent("1"));
  }
  async function ask(text: string) {
    await userEvent.type(screen.getByTestId("chat-input"), text);
    await userEvent.click(screen.getByTestId("send-button"));
  }

  it("lỗi HTTP trước khi lưu: dấu lỗi dưới đúng bong bóng, 'Thử lại' gửi lại đúng câu hỏi/phạm vi và chỉ còn MỘT tin người dùng", async () => {
    await renderPanel();
    mocks.askStream.mockRejectedValueOnce(new ApiClientError(412, "ai_not_configured", "Chưa cấu hình khoá AI"));
    await ask("Câu A?");

    const err = await screen.findByTestId("chat-send-error");
    expect(err).toHaveAttribute("role", "alert");
    expect(err).toHaveTextContent("Chưa cấu hình khoá AI");
    const bubbles = screen.getAllByTestId("user-message");
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]).toHaveTextContent("Câu A?");
    expect(err.parentElement?.previousElementSibling).toBe(bubbles[0]);
    const firstBody = bodyOf(0);
    expect(firstBody.regenerate).toBeUndefined();

    mocks.askStream.mockResolvedValueOnce(events([meta("u1"), { type: "delta", text: "Trả lời" }, done()]));
    serverMessages = [msg("u1", "user", "Câu A?"), msg("a1", "assistant", "Trả lời")];
    await userEvent.click(screen.getByTestId("chat-retry"));

    await waitFor(() => expect(screen.getByTestId("assistant-message")).toBeInTheDocument());
    expect(screen.queryByTestId("chat-send-error")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("user-message")).toHaveLength(1);
    expect(mocks.askStream).toHaveBeenCalledTimes(2);
    expect(bodyOf(1)).toEqual(firstBody); // đúng câu hỏi + scope + model đã chốt, không regenerate
    expect(bodyOf(1).question).toBe("Câu A?");
    expect(bodyOf(1).scope.sourceIds).toEqual(["s1"]);
  });

  it("lỗi giữa luồng sau khi server đã lưu (meta có userMessageId): thử lại bằng regenerate, không tạo tin người dùng trùng", async () => {
    await renderPanel();
    mocks.askStream.mockResolvedValueOnce(events([meta("u1"), { type: "error", code: "ai_provider_error", message: "Nhà cung cấp AI quá tải" }]));
    serverMessages = [msg("u1", "user", "Câu A?")];
    await ask("Câu A?");

    const err = await screen.findByTestId("chat-send-error");
    expect(err).toHaveTextContent("Nhà cung cấp AI quá tải");
    expect(screen.getAllByTestId("user-message")).toHaveLength(1);
    expect(err.parentElement?.previousElementSibling).toBe(screen.getByTestId("user-message"));

    mocks.askStream.mockResolvedValueOnce(events([meta("u1"), { type: "delta", text: "Trả lời" }, done()]));
    serverMessages = [msg("u1", "user", "Câu A?"), msg("a1", "assistant", "Trả lời")];
    await userEvent.click(screen.getByTestId("chat-retry"));

    await waitFor(() => expect(screen.getByTestId("assistant-message")).toBeInTheDocument());
    expect(screen.queryByTestId("chat-send-error")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("user-message")).toHaveLength(1);
    expect(bodyOf(1).regenerate).toBe(true);
    expect(bodyOf(1).question).toBe("Câu A?");
    expect(bodyOf(1).scope).toEqual(bodyOf(0).scope);
  });

  it("lỗi tiếp theo khi thử lại → dấu lỗi hiện lại; người dùng bấm Dừng (AbortError) → không có dấu lỗi", async () => {
    await renderPanel();
    mocks.askStream.mockRejectedValueOnce(new ApiClientError(429, "rate_limited", "Bạn hỏi quá nhanh"));
    await ask("Câu A?");
    await screen.findByTestId("chat-send-error");

    mocks.askStream.mockRejectedValueOnce(new ApiClientError(502, "connector_error", "Kết nối ngoài lỗi"));
    await userEvent.click(screen.getByTestId("chat-retry"));
    await waitFor(() => expect(screen.getByTestId("chat-send-error")).toHaveTextContent("Kết nối ngoài lỗi"));
    expect(screen.getAllByTestId("user-message")).toHaveLength(1);

    mocks.askStream.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await userEvent.click(screen.getByTestId("chat-retry"));
    await waitFor(() => expect(mocks.askStream).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByTestId("user-message")).not.toBeInTheDocument());
    expect(screen.queryByTestId("chat-send-error")).not.toBeInTheDocument();
  });

  it("dấu lỗi biến mất khi gửi câu hỏi khác và khi chuyển sang hội thoại mới", async () => {
    await renderPanel();
    mocks.askStream.mockRejectedValueOnce(new ApiClientError(412, "ai_not_configured", "Chưa cấu hình khoá AI"));
    await ask("Câu A?");
    await screen.findByTestId("chat-send-error");

    mocks.askStream.mockResolvedValueOnce(events([meta("u2"), { type: "delta", text: "Trả lời" }, done()]));
    serverMessages = [msg("u2", "user", "Câu B?"), msg("a1", "assistant", "Trả lời")];
    await ask("Câu B?");
    await waitFor(() => expect(screen.getByTestId("assistant-message")).toBeInTheDocument());
    expect(screen.queryByTestId("chat-send-error")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("user-message")).toHaveLength(1);
    expect(screen.getByTestId("user-message")).toHaveTextContent("Câu B?");

    mocks.askStream.mockRejectedValueOnce(new ApiClientError(412, "ai_not_configured", "Lại lỗi"));
    await ask("Câu C?");
    await screen.findByTestId("chat-send-error");
    await userEvent.click(screen.getByTestId("new-chat"));
    await waitFor(() => expect(screen.queryByTestId("chat-send-error")).not.toBeInTheDocument());
    expect(screen.queryByTestId("user-message")).not.toBeInTheDocument();
  });
});
