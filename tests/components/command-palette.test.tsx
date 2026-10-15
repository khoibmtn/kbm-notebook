import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, foldVi, paletteFilter } from "@/components/shared/command-palette";
import { I18nProvider } from "@/lib/i18n-client";

const NB = "11111111-1111-4111-8111-111111111111";
const NB2 = "22222222-2222-4222-8222-222222222222";
const ME = "00000000-0000-4000-8000-0000000000aa";

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: "/" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
const apiMock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...mod, api: apiMock.api };
});

const channel = (over: Record<string, unknown>) => ({
  id: "c1", notebookId: NB, type: "general", name: null, createdBy: null, createdAt: "2026-01-01T00:00:00Z", unread: 0, muted: false,
  lastReadAt: null, lastMessage: null, lastActivityAt: "2026-01-01T00:00:00Z", members: [], ...over,
});

function respond(role: "owner" | "viewer" = "owner") {
  apiMock.api.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
    if (path === "/api/notebooks") {
      return { notebooks: [
        { id: NB, title: "Sinh học tế bào", description: null, emoji: "🧬", role },
        { id: NB2, title: "Lịch sử Việt Nam", description: "Thế kỷ 20", emoji: null, role: "owner" },
      ] };
    }
    if (path === `/api/notebooks/${NB}/sources`) return { sources: [{ id: "s1", title: "Giáo trình quang hợp", summary: null, keyTopics: ["lục lạp"] }] };
    if (path === `/api/notebooks/${NB}/notes`) return { notes: [{ id: "n1", title: "Ghi chú ty thể", excerpt: "ATP" }] };
    if (path === `/api/notebooks/${NB}/artifacts` && init?.method === "POST") return { artifact: { id: "a9" } };
    if (path === `/api/notebooks/${NB}/artifacts`) return { artifacts: [{ id: "a1", type: "report", title: "Báo cáo tuần", status: "ready" }] };
    if (path === `/api/notebooks/${NB}/channels`) return { channels: [channel({ id: "c1" }), channel({ id: "c2", type: "topic", name: "thí nghiệm" })] };
    throw new Error(`unexpected ${path}`);
  });
}

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  nav.push.mockReset();
  apiMock.api.mockReset();
  nav.pathname = "/";
});

function mount() {
  return render(
    <I18nProvider locale="vi">
      <CommandPalette userId={ME} />
    </I18nProvider>,
  );
}

describe("lọc không phân biệt dấu", () => {
  it("foldVi bỏ dấu và đ", () => {
    expect(foldVi("Đường Hô Hấp")).toBe("duong ho hap");
  });
  it("mọi từ phải khớp; từ khoá phụ cũng được tính", () => {
    expect(paletteFilter("nb:1 Sinh học tế bào", "sinh hoc")).toBe(1);
    expect(paletteFilter("nb:1 Sinh học tế bào", "te sinh")).toBe(1);
    expect(paletteFilter("nb:1 Sinh học tế bào", "lich su")).toBe(0);
    expect(paletteFilter("src:1 Giáo trình", "luc lap", ["lục lạp"])).toBe(1);
  });
});

describe("CommandPalette ⌘K", () => {
  it("Ctrl+K mở; ngoài sổ tay chỉ có sổ tay + hành động Tạo sổ tay; chọn sổ tay điều hướng", async () => {
    respond();
    const user = userEvent.setup();
    mount();
    expect(screen.queryByTestId("palette-input")).toBeNull();
    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByTestId("palette-input")).toBeInTheDocument();
    expect(await screen.findAllByTestId("palette-notebook")).toHaveLength(2);
    expect(screen.queryByTestId("palette-source")).toBeNull();
    expect(screen.queryByTestId("palette-add-source")).toBeNull();
    expect(screen.getByTestId("palette-create-notebook")).toBeInTheDocument();
    // gõ không dấu vẫn tìm ra
    await user.type(screen.getByTestId("palette-input"), "lich su viet");
    await waitFor(() => expect(screen.getAllByTestId("palette-notebook")).toHaveLength(1));
    await user.click(screen.getByTestId("palette-notebook"));
    expect(nav.push).toHaveBeenCalledWith(`/n/${NB2}`);
    // Ctrl+K lần nữa đóng
    await waitFor(() => expect(screen.queryByTestId("palette-input")).toBeNull());
  });

  it("trong sổ tay: nguồn, ghi chú, artifact, kênh + hành động nhanh; liên kết sâu đúng đích", async () => {
    nav.pathname = `/n/${NB}/studio`;
    respond();
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByTestId("palette-source")).toHaveTextContent("Giáo trình quang hợp");
    expect(screen.getByTestId("palette-note")).toHaveTextContent("Ghi chú ty thể");
    expect(screen.getByTestId("palette-artifact")).toHaveTextContent("Báo cáo tuần");
    expect(screen.getAllByTestId("palette-channel")).toHaveLength(2);
    expect(screen.getByTestId("palette-add-source")).toBeInTheDocument();
    expect(screen.getByTestId("palette-create-slide_deck")).toBeInTheDocument();

    await user.click(screen.getByTestId("palette-note"));
    expect(nav.push).toHaveBeenLastCalledWith(`/n/${NB}/notes?note=n1`);
    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByTestId("palette-source"));
    expect(nav.push).toHaveBeenLastCalledWith(`/n/${NB}/sources?source=s1`);
    await user.keyboard("{Control>}k{/Control}");
    await user.click((await screen.findAllByTestId("palette-channel"))[1]);
    expect(nav.push).toHaveBeenLastCalledWith(`/n/${NB}/team?channel=c2`);
    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByTestId("palette-artifact"));
    expect(nav.push).toHaveBeenLastCalledWith(`/n/${NB}/artifacts/a1`);
  });

  it("hành động Tạo loại artifact gọi API tạo rồi mở trang artifact", async () => {
    nav.pathname = `/n/${NB}`;
    respond();
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByTestId("palette-create-infographic"));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/n/${NB}/artifacts/a9`));
    expect(apiMock.api).toHaveBeenCalledWith(`/api/notebooks/${NB}/artifacts`, { method: "POST", json: { type: "infographic" } });
  });

  it("viewer không thấy hành động tạo/thêm nguồn", async () => {
    nav.pathname = `/n/${NB}`;
    respond("viewer");
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await screen.findByTestId("palette-source");
    expect(screen.queryByTestId("palette-add-source")).toBeNull();
    expect(screen.queryByTestId("palette-create-quiz")).toBeNull();
  });
});
