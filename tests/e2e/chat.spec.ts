import { expect, test, type Page } from "@playwright/test";

const stamp = Date.now().toString(36);

async function signUpAndCreateNotebook(page: Page, tag: string) {
  const origin = new URL(page.url() === "about:blank" ? (process.env.E2E_BASE ?? `http://localhost:${process.env.E2E_PORT ?? 3200}`) : page.url()).origin;
  const email = `chat-${tag}-${stamp}@example.com`;
  const res = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { Origin: origin },
    data: { name: "Người Dùng Chat", email, password: "matkhau-e2e-123" },
  });
  expect(res.ok()).toBeTruthy();
  const nb = await page.request.post(`${origin}/api/notebooks`, {
    headers: { Origin: origin },
    data: { title: `Sổ tay chat ${tag} ${stamp}` },
  });
  expect(nb.ok()).toBeTruthy();
  const { notebook } = (await nb.json()) as { notebook: { id: string } };
  return { notebookId: notebook.id, origin };
}

test("hỏi đáp có trích dẫn: dán nguồn → hỏi → chip [1] → mở viewer có tô sáng → lưu thành ghi chú → thấy ở tab Ghi chú", async ({ page }) => {
  const { notebookId } = await signUpAndCreateNotebook(page, "a");
  await page.goto(`/n/${notebookId}`);

  // Chưa có nguồn: trạng thái rỗng thật
  const chat = page.getByTestId("chat-panel");
  await expect(chat.getByTestId("chat-empty")).toContainText("Chưa có nguồn nào sẵn sàng", { timeout: 30_000 }); // lần đầu dev server còn biên dịch route

  // Dán một nguồn văn bản và chờ "sẵn sàng"
  await page.getByTestId("add-source-button").click();
  const dlg = page.getByTestId("add-source-dialog");
  await dlg.getByRole("tab", { name: "Văn bản dán" }).click();
  await dlg.getByLabel("Tiêu đề").fill("Quang hợp");
  await dlg.getByLabel("Nội dung").fill("Quang hợp diễn ra ở lục lạp của tế bào thực vật.");
  await dlg.getByRole("button", { name: "Thêm văn bản" }).click();
  const card = page.getByTestId("source-card").filter({ hasText: "Quang hợp" });
  await expect(card).toHaveAttribute("data-status", "ready", { timeout: 30_000 });

  // Gợi ý câu hỏi được dựng từ nguồn thật
  await expect(chat.getByTestId("chat-suggestions")).toContainText("Tóm tắt nội dung chính của “Quang hợp”");
  await expect(chat.getByTestId("scope-button")).toContainText("1 nguồn");

  // Hỏi (Enter để gửi)
  const input = chat.getByTestId("chat-input");
  await input.fill("Quang hợp diễn ra ở đâu?");
  await input.press("Enter");
  await expect(chat.getByTestId("user-message")).toHaveText("Quang hợp diễn ra ở đâu?");
  const answer = chat.getByTestId("assistant-message");
  await expect(answer).toBeVisible({ timeout: 30_000 });
  const chip = answer.getByTestId("citation-chip").first();
  await expect(chip).toHaveText("[1]", { timeout: 30_000 });
  await expect(answer.getByTestId("sources-used")).toContainText("Quang hợp");
  await expect(chat.getByTestId("insufficient-banner")).toHaveCount(0);
  await expect(chat.getByTestId("conversation-switcher")).toContainText("Quang hợp diễn ra ở đâu?");

  // Hover → tooltip; bấm → viewer mở đúng đoạn, được tô sáng
  await chip.hover();
  await expect(page.getByTestId("citation-tooltip").first()).toContainText("Quang hợp diễn ra ở lục lạp");
  await chip.click();
  const viewer = page.getByTestId("source-viewer");
  await expect(viewer.getByRole("heading", { name: "Quang hợp" })).toBeVisible();
  await expect(viewer.locator("mark[data-highlight]")).toContainText("lục lạp");
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  // Lưu cặp hỏi-đáp và lưu thành ghi chú
  await answer.getByTestId("action-save-exchange").click();
  await expect(page.getByText("Đã lưu cặp hỏi-đáp")).toBeVisible();
  await answer.getByTestId("action-save-note").click();
  await expect(page.getByText("Đã lưu thành ghi chú")).toBeVisible();

  // Tab Ghi chú: ghi chú xuất hiện với huy hiệu "Từ chat", nội dung có danh sách nguồn
  await page.getByTestId("tab-notes").click();
  const notes = page.getByTestId("notes-panel");
  const item = notes.getByTestId("note-item").filter({ hasText: "Quang hợp diễn ra ở đâu?" });
  await expect(item).toBeVisible();
  await expect(item.getByTestId("note-origin")).toHaveText("Từ chat");
  await item.click();
  await expect(notes.getByTestId("note-content")).toContainText("Nguồn");
  await expect(notes.getByTestId("note-content")).toContainText("Quang hợp");
  await expect(notes.getByTestId("note-title")).toHaveValue("Quang hợp diễn ra ở đâu?");

  // Câu hỏi ngoài nguồn → cảnh báo thiếu bằng chứng
  await page.getByTestId("tab-chat").click();
  await input.fill("zzqx wwvk plmnb trdfg hjkl");
  await input.press("Enter");
  await expect(chat.getByTestId("insufficient-banner").last()).toBeVisible({ timeout: 30_000 });

  // Cuộc trò chuyện mới + đổi tên
  await chat.getByTestId("new-chat").click();
  await expect(chat.getByTestId("chat-empty")).toBeVisible();
  await chat.getByTestId("conversation-switcher").click();
  await expect(page.getByTestId("conversation-item")).toHaveCount(1);
});

test("ghi chú: soạn bằng Tiptap, tự động lưu, thêm vào Nguồn và tìm kiếm", async ({ page }) => {
  const { notebookId } = await signUpAndCreateNotebook(page, "b");
  await page.goto(`/n/${notebookId}/notes`);

  const panel = page.getByTestId("notes-panel");
  await expect(panel.getByText("Chưa có ghi chú")).toBeVisible();
  await panel.getByTestId("new-note").click();
  const title = panel.getByTestId("note-title");
  await expect(title).toBeVisible();
  await title.fill("Ôn tập chu trình Calvin");

  const content = panel.getByTestId("note-content");
  await content.click();
  await page.keyboard.type("Giai đoạn tối của quang hợp diễn ra ở stroma.");
  await expect(panel.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 10_000 });

  // Bảng bằng thanh công cụ + tải lại vẫn còn (đã lưu Markdown thật)
  await panel.getByRole("button", { name: "Chèn bảng" }).click();
  await expect(panel.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 10_000 });
  await page.reload();
  const again = page.getByTestId("notes-panel");
  await again.getByTestId("note-item").first().click();
  await expect(again.getByTestId("note-content")).toContainText("stroma");
  await expect(again.getByTestId("note-content").locator("table")).toBeVisible();

  // Tìm kiếm
  await again.getByTestId("notes-search").fill("calvin");
  await expect(again.getByTestId("note-item")).toHaveCount(1);
  await again.getByTestId("notes-search").fill("không-có-gì");
  await expect(again.getByText("Không có ghi chú phù hợp")).toBeVisible();
  await again.getByTestId("notes-search").fill("");

  // Thêm vào Nguồn → nguồn mới ở trang Nguồn
  await again.getByTestId("note-item").first().click();
  await again.getByTestId("note-menu").click();
  await page.getByTestId("note-to-source").click();
  await expect(again.getByTestId("note-is-source")).toBeVisible();
  await page.goto(`/n/${notebookId}/sources`);
  const card = page.getByTestId("source-card").filter({ hasText: "Ôn tập chu trình Calvin" });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
});
