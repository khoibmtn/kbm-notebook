import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownWithCitations } from "@/components/chat/markdown-with-citations";
import { AssistantMessage } from "@/components/chat/message-item";
import { ConnectionCard } from "@/components/connectors/connection-card";
import { NotebookProvider } from "@/components/notebook/notebook-context";
import { SourcesPanel } from "@/components/sources/sources-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Evidence } from "@/lib/chat";
import type { ConnectionDto } from "@/lib/connectors";
import type { SourceDto } from "@/lib/sources";
import { getSelectedSourceIds } from "@/lib/use-source-selection";

const apiMock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...mod, api: apiMock.api };
});
vi.mock("@/lib/realtime", () => ({
  useRealtime: () => ({ connected: false }),
  useRealtimeEvent: () => undefined,
}));

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

describe("nhập nguồn từ NotebookLM vào phạm vi Chat", () => {
  const SEL_KEY = "kbm:sources:selected:nb1";
  const ctx = {
    role: "owner" as const,
    user: { id: "u1", name: "An", email: "an@x.com" },
    notebook: { id: "nb1", title: "Sổ tay", description: null, emoji: null, coverColor: null, systemInstruction: null, allowWeb: false, defaultArtifactVisibility: "notebook" as const, ownerId: "u1" },
  };
  const conn: ConnectionDto = {
    id: "c1",
    notebookId: "nb1",
    provider: "notebooklm-bridge",
    externalId: "ext-1",
    externalUrl: null,
    label: "Giải phẫu ngoài",
    status: "ready",
    lastError: null,
    lastSyncedAt: null,
    createdAt: new Date().toISOString(),
    ownerUserId: "u1",
    ownerName: "An",
    isMine: true,
    sharedWithMembers: false,
    usable: true,
    supportsChat: true,
    canDelete: true,
    sourceCount: 2,
    sources: [],
  };
  const src = (id: string, status: SourceDto["status"]): SourceDto => ({
    id,
    notebookId: "nb1",
    kind: "text",
    fileType: null,
    title: `Nguồn ${id}`,
    mime: null,
    url: null,
    fileId: null,
    visibility: "shared",
    status,
    progress: status === "ready" ? 100 : 0,
    error: null,
    pageCount: null,
    pageUnit: null,
    tokenCount: null,
    summary: null,
    keyTopics: null,
    createdBy: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    canManage: true,
  });

  /** Dựng API giả: danh sách nguồn (đổi được sau khi nhập), kết nối, nguồn ngoài và kết quả nhập. */
  function setupApi(importResult: { imported: { externalSourceId: string; sourceId: string; title: string }[]; failed: { externalSourceId: string; message: string }[] }) {
    let sources: SourceDto[] = [src("s1", "ready")];
    apiMock.api.mockImplementation(async (path: string) => {
      if (path.endsWith("/drive/files")) {
        return { files: [{ id: "d1", name: "Tài liệu Drive", mimeType: "application/pdf", modifiedTime: null, size: null, webViewLink: null }], nextPageToken: null };
      }
      if (path.endsWith("/drive/import")) {
        sources = [...sources, src("s7", "pending")];
        return { imported: [{ driveFileId: "d1", sourceId: "s7", title: "Tài liệu Drive" }], failed: [] };
      }
      if (path.endsWith("/connections/c1/import")) {
        sources = [...sources, ...importResult.imported.map((i) => src(i.sourceId, "pending"))];
        return importResult;
      }
      if (path.endsWith("/connections/c1/sources")) {
        return { sources: [{ id: "e1", title: "Ngoài 1", kind: "text", status: "ready", url: null }, { id: "e2", title: "Ngoài 2", kind: "text", status: "ready", url: null }] };
      }
      if (path.endsWith("/connections")) return { connections: [conn] };
      if (path.endsWith("/sources")) return { sources };
      throw new Error(`api không mong đợi: ${path}`);
    });
  }

  async function openImportAndSubmit(externalTitles: string[]) {
    wrap(
      <NotebookProvider value={ctx}>
        <SourcesPanel maxUploadMb={10} />
      </NotebookProvider>,
    );
    await userEvent.click(await screen.findByTestId("connection-menu"));
    await userEvent.click(await screen.findByTestId("connection-import"));
    for (const title of externalTitles) await userEvent.click(await screen.findByRole("checkbox", { name: title }));
    await userEvent.click(screen.getByTestId("import-submit"));
  }

  beforeEach(() => {
    apiMock.api.mockReset();
    localStorage.clear();
  });

  it("nguồn vừa nhập (còn pending) được thêm vào lựa chọn Chat ngay", async () => {
    setupApi({ imported: [{ externalSourceId: "e1", sourceId: "s9", title: "Ngoài 1" }], failed: [] });
    await openImportAndSubmit(["Ngoài 1"]);
    await waitFor(() => expect(getSelectedSourceIds("nb1")).toContain("s9"));
    expect(JSON.parse(localStorage.getItem(SEL_KEY)!)).toEqual(["s1", "s9"]);
  });

  it("nhập một phần: chỉ id của nguồn nhập được vào lựa chọn", async () => {
    setupApi({
      imported: [{ externalSourceId: "e1", sourceId: "s9", title: "Ngoài 1" }],
      failed: [{ externalSourceId: "e2", message: "Không lấy được nội dung" }],
    });
    await openImportAndSubmit(["Ngoài 1", "Ngoài 2"]);
    await waitFor(() => expect(getSelectedSourceIds("nb1")).toContain("s9"));
    expect(getSelectedSourceIds("nb1")).toEqual(["s1", "s9"]);
    expect(await screen.findByText("Không lấy được nội dung")).toBeInTheDocument();
  });

  it("không nhập được nguồn nào: không đổi lựa chọn đã lưu", async () => {
    setupApi({ imported: [], failed: [{ externalSourceId: "e1", message: "Lỗi nhập" }] });
    await openImportAndSubmit(["Ngoài 1"]);
    expect(await screen.findByText("Lỗi nhập")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SEL_KEY)!)).toEqual(["s1"]);
  });

  it("hồi quy: nguồn nhập từ Google Drive cũng tự vào lựa chọn Chat", async () => {
    setupApi({ imported: [], failed: [] });
    wrap(
      <NotebookProvider value={ctx}>
        <SourcesPanel maxUploadMb={10} />
      </NotebookProvider>,
    );
    await userEvent.click(await screen.findByTestId("add-source-button"));
    await userEvent.click(await screen.findByTestId("tab-drive"));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Tài liệu Drive" }));
    await userEvent.click(screen.getByTestId("drive-import-submit"));
    await waitFor(() => expect(getSelectedSourceIds("nb1")).toContain("s7"));
    expect(getSelectedSourceIds("nb1")).toEqual(["s1", "s7"]);
  });
});
