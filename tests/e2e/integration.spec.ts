import { expect, test, type Page } from "@playwright/test";

const stamp = Date.now().toString(36);

const SOURCE_TEXT =
  "Quang hợp là quá trình thực vật chuyển hoá ánh sáng mặt trời, nước và khí cacbonic thành glucose và oxy trong lục lạp của tế bào. " +
  "Ty thể là bào quan tạo ra ATP thông qua hô hấp tế bào, thường được gọi là nhà máy năng lượng của tế bào. " +
  "Ribosome tổng hợp protein dựa trên thông tin di truyền do RNA thông tin mang đến từ nhân tế bào.";

const origin = () => process.env.E2E_BASE ?? `http://localhost:${process.env.E2E_PORT ?? 3200}`;

/** Đăng ký + sổ tay + nguồn (sẵn sàng) + ghi chú + artifact (báo cáo) qua API. */
async function setup(page: Page, tag: string) {
  const o = origin();
  const h = { Origin: o };
  const res = await page.request.post(`${o}/api/auth/sign-up/email`, {
    headers: h,
    data: { name: "Người Tích Hợp", email: `integ-${tag}-${stamp}@example.com`, password: "matkhau-e2e-123" },
  });
  expect(res.ok()).toBeTruthy();
  const nb = await page.request.post(`${o}/api/notebooks`, { headers: h, data: { title: `Sổ tay tích hợp ${tag} ${stamp}` } });
  const notebookId = ((await nb.json()) as { notebook: { id: string } }).notebook.id;
  const src = await page.request.post(`${o}/api/notebooks/${notebookId}/sources`, { headers: h, data: { kind: "text", title: "Bài giảng tế bào", text: SOURCE_TEXT } });
  const sourceId = ((await src.json()) as { source: { id: string } }).source.id;
  await expect
    .poll(async () => ((await (await page.request.get(`${o}/api/notebooks/${notebookId}/sources`)).json()) as { sources: { status: string }[] }).sources[0]?.status, { timeout: 30_000 })
    .toBe("ready");
  const note = await page.request.post(`${o}/api/notebooks/${notebookId}/notes`, { headers: h, data: { title: "Ghi chú tích hợp", contentMd: "Nội dung ghi chú về ty thể." } });
  const noteId = ((await note.json()) as { note: { id: string } }).note.id;
  const art = await page.request.post(`${o}/api/notebooks/${notebookId}/artifacts`, { headers: h, data: { type: "report", title: "Báo cáo tích hợp" } });
  const artifactId = ((await art.json()) as { artifact: { id: string } }).artifact.id;
  await expect
    .poll(async () => ((await (await page.request.get(`${o}/api/artifacts/${artifactId}`)).json()) as { artifact: { status: string } }).artifact.status, { timeout: 40_000 })
    .toBe("ready");
  return { notebookId, sourceId, noteId, artifactId };
}

test("liên kết sâu: ?note= mở ghi chú, ?source= mở Source viewer", async ({ page }) => {
  const { notebookId, sourceId, noteId } = await setup(page, "deep");
  await page.goto(`/n/${notebookId}/notes?note=${noteId}`);
  await expect(page.getByTestId("note-title")).toHaveValue("Ghi chú tích hợp", { timeout: 30_000 });
  await expect(page.getByTestId("note-content")).toContainText("Nội dung ghi chú về ty thể.");

  await page.goto(`/n/${notebookId}/sources?source=${sourceId}`);
  await expect(page.getByTestId("source-viewer")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("source-viewer")).toContainText("Quang hợp");
});

test("Chia sẻ vào chat: artifact (menu ⋯ và trang artifact), ghi chú và nguồn → thẻ trong chat mở đúng đích", async ({ page }) => {
  test.setTimeout(180_000);
  const { notebookId, sourceId, noteId, artifactId } = await setup(page, "share");
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1) Studio: menu ⋯ của artifact
  await page.goto(`/n/${notebookId}`);
  const row = page.getByTestId("studio-panel").getByTestId("artifact-row").first();
  await expect(row).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  await row.getByTestId("artifact-menu").click();
  await page.getByTestId("artifact-share-to-chat").click();
  let dialog = page.getByRole("dialog", { name: "Chia sẻ vào chat" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio").first().click();
  await dialog.getByRole("button", { name: "Chia sẻ", exact: true }).click();
  await expect(dialog).toBeHidden();

  // 2) Trang artifact: nút trên thanh tiêu đề
  await page.goto(`/n/${notebookId}/artifacts/${artifactId}`);
  await page.getByTestId("artifact-share-to-chat").click();
  dialog = page.getByRole("dialog", { name: "Chia sẻ vào chat" });
  await dialog.getByPlaceholder("Lời nhắn kèm theo (tuỳ chọn)").fill("Xem báo cáo này nhé");
  await dialog.getByRole("button", { name: "Chia sẻ", exact: true }).click();
  await expect(dialog).toBeHidden();

  // 3) Ghi chú: menu của ghi chú đang mở
  await page.goto(`/n/${notebookId}/notes?note=${noteId}`);
  await page.getByTestId("note-menu").click();
  await page.getByTestId("note-share-to-chat").click();
  await page.getByRole("dialog", { name: "Chia sẻ vào chat" }).getByRole("button", { name: "Chia sẻ", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Chia sẻ vào chat" })).toBeHidden();

  // 4) Nguồn: menu thẻ nguồn
  await page.goto(`/n/${notebookId}/sources`);
  await page.getByTestId("source-card").first().getByRole("button", { name: "Tuỳ chọn nguồn" }).click();
  await page.getByTestId("source-share-to-chat").click();
  await page.getByRole("dialog", { name: "Chia sẻ vào chat" }).getByRole("button", { name: "Chia sẻ", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Chia sẻ vào chat" })).toBeHidden();

  // Trang Nhóm: 4 thẻ; mở từng thẻ đúng đích
  await page.goto(`/n/${notebookId}/team`);
  const cards = page.getByTestId("ref-card");
  await expect(cards).toHaveCount(4, { timeout: 30_000 });
  await expect(page.getByText("Xem báo cáo này nhé")).toBeVisible();

  await cards.filter({ hasText: "Ghi chú tích hợp" }).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/n/${notebookId}/notes\\?note=${noteId}`));
  await expect(page.getByTestId("note-title")).toHaveValue("Ghi chú tích hợp", { timeout: 30_000 });

  await page.goto(`/n/${notebookId}/team`);
  await page.getByTestId("ref-card").filter({ hasText: "Bài giảng tế bào" }).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/n/${notebookId}/sources\\?source=${sourceId}`));
  await expect(page.getByTestId("source-viewer")).toBeVisible({ timeout: 30_000 });

  await page.goto(`/n/${notebookId}/team`);
  await page.getByTestId("ref-card").filter({ hasText: "Báo cáo tích hợp" }).first().getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/n/${notebookId}/artifacts/${artifactId}$`));
  await expect(page.getByTestId("artifact-title")).toHaveText("Báo cáo tích hợp");
});

test("di động: thanh tab dưới có Nhóm và mở được chat nhóm", async ({ page }) => {
  const { notebookId } = await setup(page, "mobile");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/n/${notebookId}`);
  const tab = page.getByTestId("mobile-tab-team");
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tablist").last().getByRole("tab")).toHaveText(["Nguồn", "Chat", "Studio", "Nhóm"]);
  await tab.click();
  // Chat nhóm hiện ra trong tab: có kênh General (chọn thì có khung soạn tin)
  await expect(page.getByTestId("channel-item").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("channel-item").first().click();
  await expect(page.getByTestId("composer-input")).toBeVisible();
});

test("bảng lệnh ⌘K: tìm không dấu artifact/ghi chú/nguồn trong sổ tay và điều hướng; tạo sổ tay từ bảng lệnh", async ({ page }) => {
  const { notebookId, artifactId, noteId } = await setup(page, "palette");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/n/${notebookId}`);
  await expect(page.getByTestId("studio-panel")).toBeVisible({ timeout: 30_000 });

  await page.keyboard.press("ControlOrMeta+K");
  const input = page.getByTestId("palette-input");
  await expect(input).toBeVisible();
  await input.fill("bao cao tich hop");
  await expect(page.getByTestId("palette-artifact")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/n/${notebookId}/artifacts/${artifactId}$`));

  await page.keyboard.press("ControlOrMeta+K");
  await page.getByTestId("palette-input").fill("ghi chu tich hop");
  await page.getByTestId("palette-note").click();
  await expect(page).toHaveURL(new RegExp(`/n/${notebookId}/notes\\?note=${noteId}`));

  // hành động nhanh: Thêm nguồn mở hộp thêm nguồn
  await page.keyboard.press("ControlOrMeta+K");
  await page.getByTestId("palette-add-source").click();
  await expect(page).toHaveURL(new RegExp(`/n/${notebookId}/sources\\?add=1`));
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");

  // Tạo sổ tay từ bảng lệnh
  await page.keyboard.press("ControlOrMeta+K");
  await page.getByTestId("palette-create-notebook").click();
  await expect(page.getByRole("dialog").getByLabel("Tiêu đề")).toBeVisible();
});
