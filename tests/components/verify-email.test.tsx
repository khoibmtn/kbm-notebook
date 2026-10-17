import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VerifyEmailBanner } from "@/components/auth/verify-email-banner";
import { I18nProvider } from "@/lib/i18n-client";

const send = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { sendVerificationEmail: send } }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  send.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

const renderBanner = () =>
  render(
    <I18nProvider locale="vi">
      <VerifyEmailBanner email="nguoi@dung.vn" />
    </I18nProvider>,
  );

describe("banner Email chưa xác minh", () => {
  it("hiển thị cảnh báo và nút gửi lại; bấm gửi lại gọi better-auth với đúng email", async () => {
    send.mockResolvedValue({ error: null });
    renderBanner();
    expect(screen.getByTestId("verify-email-banner")).toHaveTextContent("chưa được xác minh");
    await userEvent.click(screen.getByRole("button", { name: "Gửi lại email xác minh" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ email: "nguoi@dung.vn", callbackURL: "/" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("nguoi@dung.vn")));
  });

  it("báo lỗi khi gửi lại thất bại", async () => {
    send.mockResolvedValue({ error: { message: "x" } });
    renderBanner();
    await userEvent.click(screen.getByRole("button", { name: "Gửi lại email xác minh" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không gửi lại được email xác minh. Thử lại sau ít phút."));
  });
});
