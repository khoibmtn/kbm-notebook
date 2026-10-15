import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderOpen } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "@/components/shared/empty-state";
import { NotebookWorkspace } from "@/components/notebook/notebook-workspace";
import { I18nProvider } from "@/lib/i18n-client";
import { en } from "@/i18n/en";
import { t } from "@/lib/i18n";
import { vi as viDict } from "@/i18n/vi";

function mockMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }),
  });
}

describe("i18n", () => {
  it("en có đủ khoá như vi và không rỗng", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(viDict).sort());
    for (const v of Object.values(en)) expect(v.length).toBeGreaterThan(0);
  });

  it("t() mặc định tiếng Việt, nội suy tham số, chọn được en", () => {
    expect(t("auth.login.title")).toBe("Đăng nhập");
    expect(t("auth.login.title", undefined, "en")).toBe("Sign in");
    expect(t("validation.passwordMin", { min: 8 })).toBe("Mật khẩu tối thiểu 8 ký tự");
    expect(t("members.remove.confirm", { name: "An" }, "en")).toBe("Remove An from this notebook?");
  });
});

describe("EmptyState", () => {
  it("hiển thị tiêu đề, mô tả và nhãn 'Đang phát triển', không có dữ liệu giả", () => {
    render(
      <EmptyState icon={FolderOpen} title="Nguồn tri thức" description="Mô tả" badge={t("module.comingSoon")} />,
    );
    expect(screen.getByRole("heading", { name: "Nguồn tri thức" })).toBeInTheDocument();
    expect(screen.getByText("Đang phát triển")).toBeInTheDocument();
  });
});

describe("NotebookWorkspace", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const slots = {
    sources: <div>SLOT-SOURCES</div>,
    main: <div>SLOT-MAIN</div>,
    studio: <div>SLOT-STUDIO</div>,
  };

  it("≥1024px: hiện 3 cột cùng lúc", () => {
    mockMedia(true);
    render(
      <I18nProvider locale="vi">
        <NotebookWorkspace {...slots} />
      </I18nProvider>,
    );
    expect(screen.getByText("SLOT-SOURCES")).toBeInTheDocument();
    expect(screen.getByText("SLOT-MAIN")).toBeInTheDocument();
    expect(screen.getByText("SLOT-STUDIO")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("thu gọn cột nguồn ẩn nội dung và lưu trạng thái vào localStorage", async () => {
    mockMedia(true);
    const user = userEvent.setup();
    render(
      <I18nProvider locale="vi">
        <NotebookWorkspace {...slots} />
      </I18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Thu gọn cột Nguồn/ }));
    expect(screen.queryByText("SLOT-SOURCES")).toBeNull();
    expect(localStorage.getItem("kbm:workspace:sources")).toBe("1");
    await act(async () => {});
    await user.click(screen.getByRole("button", { name: /Mở rộng cột Nguồn/ }));
    expect(screen.getByText("SLOT-SOURCES")).toBeInTheDocument();
  });

  it("<1024px: gộp thành 3 tab, mặc định tab Chat", async () => {
    mockMedia(false);
    const user = userEvent.setup();
    render(
      <I18nProvider locale="vi">
        <NotebookWorkspace {...slots} />
      </I18nProvider>,
    );
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual(["Nguồn", "Chat", "Studio"]);
    expect(screen.getByText("SLOT-MAIN")).toBeInTheDocument();
    expect(screen.queryByText("SLOT-SOURCES")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Studio" }));
    expect(screen.getByText("SLOT-STUDIO")).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
