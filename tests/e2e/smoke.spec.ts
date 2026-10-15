import { expect, test } from "@playwright/test";

const stamp = Date.now().toString(36);

test("đăng ký → tạo sổ tay → thấy trên dashboard → mở không gian sổ tay", async ({ page }) => {
  const email = `e2e-${stamp}@example.com`;
  const title = `Sổ tay e2e ${stamp}`;

  // Chưa đăng nhập: vào / bị chuyển về /login
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  await page.getByRole("link", { name: "Đăng ký" }).click();
  await expect(page.getByRole("heading", { name: "Đăng ký" })).toBeVisible();
  await page.getByLabel("Họ và tên").fill("Người Dùng E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("matkhau-e2e-123");
  await page.getByLabel("Nhập lại mật khẩu").fill("matkhau-e2e-123");
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();

  // Dashboard rỗng (không dữ liệu giả)
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Sổ tay của tôi" })).toBeVisible();
  await expect(page.getByTestId("onboarding")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bắt đầu với KBM Notebook" })).toBeVisible();

  // Tạo sổ tay
  await page.getByRole("button", { name: "Tạo sổ tay" }).first().click();
  await page.getByLabel("Tiêu đề").fill(title);
  await page.getByRole("dialog").getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(page).toHaveURL(/\/n\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  // không gian 3 cột thật (không còn khung giữ chỗ "Đang phát triển")
  await expect(page.getByTestId("sources-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("studio-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Đang phát triển")).toHaveCount(0);

  // Quay về dashboard: thấy thẻ sổ tay với vai trò Chủ sở hữu
  await page.getByRole("link", { name: "Về trang chủ" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  const card = page.getByTestId("notebook-list").getByRole("link", { name: new RegExp(title) });
  await expect(card).toBeVisible();
  await expect(card.getByText("Chủ sở hữu")).toBeVisible();

  // Tìm kiếm lọc theo tên
  await page.getByPlaceholder("Tìm sổ tay…").fill("không-tồn-tại-xyz");
  await expect(page.getByText("Không có sổ tay nào khớp với tìm kiếm")).toBeVisible();
  await page.getByPlaceholder("Tìm sổ tay…").fill(stamp);
  await expect(card).toBeVisible();
});

test("mời thành viên chưa có tài khoản → nhận liên kết mời; người được mời tham gia", async ({ page, browser }) => {
  const ownerEmail = `owner-${stamp}@example.com`;
  const guestEmail = `guest-${stamp}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Họ và tên").fill("Chủ Sổ Tay");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("matkhau-e2e-123");
  await page.getByLabel("Nhập lại mật khẩu").fill("matkhau-e2e-123");
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("button", { name: "Tạo sổ tay" }).first().click();
  await page.getByLabel("Tiêu đề").fill(`Nhóm học ${stamp}`);
  await page.getByRole("dialog").getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(page).toHaveURL(/\/n\/[0-9a-f-]{36}$/);

  await page.getByRole("link", { name: "Thành viên" }).first().click();
  await page.getByLabel("Email", { exact: true }).fill(guestEmail);
  await page.getByRole("button", { name: "Mời", exact: true }).click();
  const link = page.getByTestId("invite-link");
  await expect(link).toContainText("/invite/");
  const inviteUrl = (await link.textContent())!.trim();

  // Người được mời (ngữ cảnh trình duyệt riêng) đăng ký rồi chấp nhận
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? undefined });
  const guest = await ctx.newPage();
  await guest.goto(inviteUrl);
  await expect(guest.getByText("mời bạn tham gia")).toBeVisible();
  await guest.getByRole("link", { name: "Đăng ký" }).click();
  await guest.getByLabel("Họ và tên").fill("Khách Mời");
  await guest.getByLabel("Email").fill(guestEmail);
  await guest.getByLabel("Mật khẩu", { exact: true }).fill("matkhau-e2e-123");
  await guest.getByLabel("Nhập lại mật khẩu").fill("matkhau-e2e-123");
  await guest.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(guest.getByRole("button", { name: "Tham gia sổ tay" })).toBeVisible();
  await guest.getByRole("button", { name: "Tham gia sổ tay" }).click();
  await expect(guest).toHaveURL(/\/n\/[0-9a-f-]{36}$/);
  await ctx.close();

  // Chủ sổ tay thấy thành viên mới
  await page.reload();
  await expect(page.getByTestId("member-list").getByText(guestEmail)).toBeVisible();
});
