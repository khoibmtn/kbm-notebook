import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownWithCitations } from "@/components/chat/markdown-with-citations";
import { AssistantMessage } from "@/components/chat/message-item";
import { ConnectionCard } from "@/components/connectors/connection-card";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Evidence } from "@/lib/chat";
import type { ConnectionDto } from "@/lib/connectors";

const evidence: Evidence[] = [
  { id: "c1", provider: "local", sourceId: "s1", sourceTitle: "Giáo trình", locator: { page: 3 }, text: "Quang hợp ở lục lạp.", score: 0.03, similarity: 0.7 },
  {
    id: "nlm:1:s9:5-40",
    provider: "notebooklm-bridge",
    kind: "chunk",
    connectionId: "conn-1",
    externalUrl: "https://notebooklm.google.com/notebook/ext-1",
    sourceId: "s9",
    sourceTitle: "Giải phẫu tim",
    locator: { startChar: 5, endChar: 40, section: "NotebookLM" },
    text: "Tim gồm hai tâm nhĩ và hai tâm thất.",
    score: 0.02,
  },
  {
    id: "nlm:1:answer",
    provider: "notebooklm-bridge",
    kind: "external_answer",
    connectionId: "conn-1",
    externalUrl: "https://notebooklm.google.com/notebook/ext-1",
    sourceId: null,
    sourceTitle: "Câu trả lời của NotebookLM · Giải phẫu ngoài",
    locator: { section: "NotebookLM" },
    text: "Tim có bốn buồng.",
    score: 0.01,
  },
];

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

const wrap = (ui: React.ReactElement) => render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);

describe("chip trích dẫn nguồn ngoài (NotebookLM)", () => {
  it("bấm chip mở popover: tên nguồn ngoài, trích đoạn và liên kết notebook; không gọi trình xem cục bộ", async () => {
    const onOpen = vi.fn();
    wrap(<MarkdownWithCitations evidence={evidence} onCitationOpen={onOpen} content="Cục bộ [1], ngoài [2], câu trả lời [3]." />);
    const chips = screen.getAllByTestId("citation-chip");
    expect(chips).toHaveLength(3);
    expect(chips[0]).not.toHaveAttribute("data-provider");
    expect(chips[1]).toHaveAttribute("data-provider", "notebooklm-bridge");

    await userEvent.click(chips[1]);
    const pop = await screen.findByTestId("external-citation-popover");
    expect(within(pop).getByTestId("external-citation-title")).toHaveTextContent("Giải phẫu tim");
    expect(within(pop).getByTestId("external-citation-text")).toHaveTextContent("Tim gồm hai tâm nhĩ và hai tâm thất.");
    const link = within(pop).getByTestId("external-citation-link");
    expect(link).toHaveAttribute("href", "https://notebooklm.google.com/notebook/ext-1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(within(pop).getByText(/không có trình xem cục bộ/)).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("chip của câu trả lời NotebookLM ghi rõ nội dung thuộc NotebookLM", async () => {
    wrap(<MarkdownWithCitations evidence={evidence} content="Theo NotebookLM [3]." />);
    await userEvent.click(screen.getByTestId("citation-chip"));
    const pop = await screen.findByTestId("external-citation-popover");
    expect(within(pop).getByText(/Câu trả lời do NotebookLM tạo/)).toBeInTheDocument();
  });

  it("'Nguồn đã dùng' của nguồn ngoài là liên kết mở NotebookLM, không phải nút mở trình xem", () => {
    wrap(
      <AssistantMessage
        message={{
          id: "m1",
          content: "Cục bộ [1], ngoài [2].",
          citations: evidence,
          sourcesUsed: [
            { key: "local:s1", sourceId: "s1", provider: "local", title: "Giáo trình", locators: ["trang 3"], numbers: [1] },
            { key: "notebooklm-bridge:conn-1:s9", sourceId: "s9", provider: "notebooklm-bridge", title: "Giải phẫu tim", locators: ['mục "NotebookLM"'], numbers: [2] },
          ],
          insufficientEvidence: false,
          model: null,
        }}
        evidence={evidence}
        onCitationOpen={() => {}}
      />,
    );
    const used = screen.getAllByTestId("source-used");
    expect(used[0].tagName).toBe("BUTTON");
    expect(used[1].tagName).toBe("A");
    expect(used[1]).toHaveAttribute("href", "https://notebooklm.google.com/notebook/ext-1");
    expect(used[1]).toHaveTextContent("NotebookLM");
  });
});

describe("ConnectionCard", () => {
  const base: ConnectionDto = {
    id: "c1",
    notebookId: "n1",
    provider: "notebooklm-bridge",
    externalId: "ext-1",
    externalUrl: "https://notebooklm.google.com/notebook/ext-1",
    label: "Giải phẫu ngoài",
    status: "ready",
    lastError: null,
    lastSyncedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ownerUserId: "u1",
    ownerName: "An",
    isMine: true,
    sharedWithMembers: false,
    usable: true,
    supportsChat: true,
    canDelete: true,
    sourceCount: 3,
    sources: [],
  };
  const actions = { onSync: vi.fn(), onImport: vi.fn(), onToggleShared: vi.fn(), onRefreshCredentials: vi.fn(), onRemove: vi.fn() };

  it("hiện nhãn, nhà cung cấp, số nguồn và trạng thái lấy từ dữ liệu thật của server", () => {
    wrap(<ul><ConnectionCard connection={base} actions={actions} canEdit /></ul>);
    expect(screen.getByTestId("connection-label")).toHaveTextContent("Giải phẫu ngoài");
    expect(screen.getByTestId("connection-provider")).toHaveTextContent("NotebookLM Bridge");
    expect(screen.getByTestId("connection-source-count")).toHaveTextContent("3 nguồn");
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "ready");
  });

  it("trạng thái lỗi hiện thông báo lỗi thật; kết nối của người khác chưa chia sẻ không lộ số nguồn/lỗi và không có menu thao tác", () => {
    const failing: ConnectionDto = { ...base, status: "error", lastError: "Bridge từ chối token (401)." };
    const { unmount } = wrap(<ul><ConnectionCard connection={failing} actions={actions} canEdit /></ul>);
    expect(screen.getByTestId("connection-error")).toHaveTextContent("Bridge từ chối token (401).");
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "error");
    unmount();

    const foreign: ConnectionDto = { ...base, isMine: false, usable: false, supportsChat: false, canDelete: false, sourceCount: 0, lastError: "Kết nối đang lỗi", status: "error", ownerName: "Bình" };
    wrap(<ul><ConnectionCard connection={foreign} actions={actions} canEdit /></ul>);
    expect(screen.queryByTestId("connection-source-count")).not.toBeInTheDocument();
    expect(screen.queryByTestId("connection-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("connection-menu")).not.toBeInTheDocument();
    expect(screen.getByText(/Của Bình/)).toBeInTheDocument();
  });
});
