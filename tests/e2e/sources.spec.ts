import { expect, test, type Page } from "@playwright/test";
import { makePdf } from "../helpers/docs";

const stamp = Date.now().toString(36);

async function signUpAndCreateNotebook(page: Page, tag: string) {
  const origin = new URL(page.url() === "about:blank" ? (process.env.E2E_BASE ?? `http://localhost:${process.env.E2E_PORT ?? 3200}`) : page.url()).origin;
  const email = `src-${tag}-${stamp}@example.com`;
  const res = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { Origin: origin },
    data: { name: "Người Dùng Nguồn", email, password: "matkhau-e2e-123" },
  });
  expect(res.ok()).toBeTruthy();
  const nb = await page.request.post(`${origin}/api/notebooks`, {
    headers: { Origin: origin },
    data: { title: `Sổ tay nguồn ${tag} ${stamp}` },
  });
  expect(nb.ok()).toBeTruthy();
  const { notebook } = (await nb.json()) as { notebook: { id: string } };
  return { notebookId: notebook.id, origin };
}

test("thêm nguồn: kéo thả tệp → xử lý realtime → xem trang → tô sáng đoạn; văn bản dán riêng tư", async ({ page }) => {
  const { notebookId, origin } = await signUpAndCreateNotebook(page, "a");
  await page.goto(`/n/${notebookId}`);

  // Trạng thái rỗng có nút hành động chính
  const panel = page.getByTestId("sources-panel");
  await expect(panel.getByText("Chưa có nguồn nào")).toBeVisible();

  // Mở hộp thoại, tải PDF thật 3 trang + tệp không hỗ trợ
  await panel.getByTestId("add-source-button").click();
  const dialog = page.getByTestId("add-source-dialog");
  await expect(dialog.getByTestId("source-dropzone")).toBeVisible();
  const pdf = await makePdf([
    "Trang mot noi ve quang hop va diep luc trong la cay.",
    "Trang hai noi ve ty the, nha may nang luong ATP cua te bao.",
    "Trang ba noi ve ribosome tong hop protein.",
  ]);
  await dialog.getByTestId("source-file-input").setInputFiles([
    { name: "sinh-hoc.pdf", mimeType: "application/pdf", buffer: pdf },
    { name: "virus.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") },
  ]);
  await expect(dialog.getByText("Định dạng của “virus.exe” chưa được hỗ trợ").first()).toBeVisible();
  await expect(dialog.getByText("Đã tải lên")).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");

  // Thẻ nguồn hiện ra và chuyển sang "sẵn sàng" (worker + realtime/polling)
  const card = panel.getByTestId("source-card").filter({ hasText: "sinh-hoc.pdf" });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  await expect(card.getByText("3 trang")).toBeVisible();
  await expect(page.getByTestId("sources-count")).toHaveText("1 nguồn");

  // Mở viewer: tóm tắt + từng trang
  await card.getByRole("button", { name: "Tuỳ chọn nguồn" }).click();
  await page.getByRole("menuitem", { name: "Xem" }).click();
  const viewer = page.getByTestId("source-viewer");
  await expect(viewer.getByRole("heading", { name: "sinh-hoc.pdf" })).toBeVisible();
  await expect(viewer.getByText("Tóm tắt")).toBeVisible();
  await expect(viewer.getByText("Trang 1", { exact: true })).toBeVisible();
  await expect(viewer.getByText("Trang 3", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // Deep-link tới chunk của trang 2: đoạn được tô sáng
  const list = await page.request.get(`${origin}/api/notebooks/${notebookId}/sources`);
  const sourceId = ((await list.json()) as { sources: { id: string }[] }).sources[0].id;
  const detail = await page.request.get(`${origin}/api/notebooks/${notebookId}/sources/${sourceId}`);
  const chunks = ((await detail.json()) as { source: { chunks: { id: string; page: number }[] } }).source.chunks;
  const chunk2 = chunks.find((c) => c.page === 2)!;
  await page.goto(`/n/${notebookId}/sources/${sourceId}?chunk=${chunk2.id}&page=2`);
  const mark = page.locator("mark[data-highlight]");
  await expect(mark).toBeVisible();
  await expect(mark).toContainText("ty the");
  await expect(mark).toBeInViewport();

  // Quay lại, thêm văn bản dán ở chế độ riêng tư
  await page.goto(`/n/${notebookId}/sources`);
  await page.getByTestId("add-source-button").click();
  const dlg = page.getByTestId("add-source-dialog");
  await dlg.getByRole("tab", { name: "Văn bản dán" }).click();
  await dlg.getByLabel("Tiêu đề").fill("Ghi chú riêng");
  await dlg.getByLabel("Nội dung").fill("Đây là ghi chú riêng tư về định lý Pythagoras. Bình phương cạnh huyền bằng tổng bình phương hai cạnh góc vuông.");
  await dlg.getByLabel("Riêng tư (chỉ mình tôi)").click();
  await dlg.getByRole("button", { name: "Thêm văn bản" }).click();
  const priv = page.getByTestId("source-card").filter({ hasText: "Ghi chú riêng" });
  await expect(priv).toBeVisible();
  await expect(priv).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  await expect(priv.getByLabel("Riêng tư")).toBeVisible();

  // Chọn tất cả / bỏ chọn
  const selectAll = page.getByTestId("select-all-sources");
  await expect(selectAll).toBeChecked();
  await selectAll.click();
  await expect(selectAll).not.toBeChecked();
  await expect(priv.getByRole("checkbox")).not.toBeChecked();
  await priv.getByRole("checkbox").click();
  await expect(page.getByTestId("sources-count")).toHaveText("1/2");

  // Đổi tên, xoá
  await priv.getByRole("button", { name: "Tuỳ chọn nguồn" }).click();
  await page.getByRole("menuitem", { name: "Đổi tên" }).click();
  await page.getByRole("textbox", { name: "Tên nguồn" }).fill("Ghi chú đã đổi");
  await page.getByRole("dialog").getByRole("button", { name: "Lưu" }).click();
  const renamed = page.getByTestId("source-card").filter({ hasText: "Ghi chú đã đổi" });
  await expect(renamed).toBeVisible();
  await renamed.getByRole("button", { name: "Tuỳ chọn nguồn" }).click();
  await page.getByRole("menuitem", { name: "Xoá" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Xoá" }).click();
  await expect(renamed).toHaveCount(0);
});
