import { expect, test, type Page } from "@playwright/test";
import { startFakeBridge, type FakeBridge } from "../helpers/fake-bridge";

const stamp = Date.now().toString(36);

let bridge: FakeBridge;

test.beforeAll(async () => {
  // Bridge giả nói đúng hợp đồng JSON của sidecar (sandbox không đăng nhập được Google thật).
  bridge = await startFakeBridge();
  bridge.addNotebook("ext-1", "Giải phẫu ngoài", [
    { id: "ext-1-a", title: "Giải phẫu tim", fulltext: "Tim có bốn buồng: hai tâm nhĩ và hai tâm thất." },
    { id: "ext-1-b", title: "Hệ tuần hoàn", fulltext: "Máu chảy trong hệ tuần hoàn kín." },
  ]);
  bridge.askAnswer = () => ({
    answer: "Tim có bốn buồng [1].",
    references: [{ source_id: "ext-1-a", cited_text: "Tim gồm hai tâm nhĩ và hai tâm thất.", start_char: 0, end_char: 36 }],
  });
});
test.afterAll(async () => {
  await bridge.close();
});

async function signUp(page: Page, tag: string) {
  const origin = new URL(page.url() === "about:blank" ? (process.env.E2E_BASE ?? `http://localhost:${process.env.E2E_PORT ?? 3200}`) : page.url()).origin;
  const res = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { Origin: origin },
    data: { name: "Người Dùng Kết Nối", email: `conn-${tag}-${stamp}@example.com`, password: "matkhau-e2e-123" },
  });
  expect(res.ok()).toBeTruthy();
  return origin;
}

test("cài đặt Kết nối: kiểm tra Bridge thật (lỗi + thành công), Drive báo rõ chưa cấu hình Google", async ({ page }) => {
  await signUp(page, "a");
  await page.goto("/settings?tab=connectors");

  // Cảnh báo không chính thức luôn hiện; trước khi kiểm tra không có trạng thái "đã kết nối" giả
  const card = page.getByTestId("bridge-card");
  await expect(card.getByTestId("bridge-warning")).toContainText("không chính thức", { timeout: 30_000 });
  await expect(card.getByTestId("bridge-warning")).toContainText("bridge/notebooklm/README.md");
  await expect(card.getByTestId("bridge-saved-badge")).toHaveText("Chưa cấu hình");
  await expect(card.getByText("Chưa kiểm tra kết nối trong phiên này")).toBeVisible();

  // Địa chỉ localhost: hiện cảnh báo + ô đồng ý; chưa đồng ý thì máy chủ từ chối với thông báo thật
  await card.getByTestId("bridge-url").fill(bridge.url);
  await card.getByTestId("bridge-token").fill("sai-token-sai-token-0000");
  await expect(card.getByTestId("bridge-private-warning")).toBeVisible();
  await card.getByTestId("bridge-test").click();
  await expect(card.getByTestId("bridge-test-error")).toContainText("Cho phép địa chỉ nội bộ");

  // Đồng ý + token sai → lỗi 401 thật từ bridge
  await card.getByTestId("bridge-private-switch").click();
  await card.getByTestId("bridge-test").click();
  await expect(card.getByTestId("bridge-test-error")).toContainText("Bridge từ chối token");

  // Token đúng → /health thật: authenticated + account
  await card.getByTestId("bridge-token").fill(bridge.token);
  await card.getByTestId("bridge-test").click();
  await expect(card.getByTestId("bridge-test-ok")).toContainText("nguoi.dung@example.com");
  expect(bridge.calls.some((c) => c.path === "/health" && c.auth === `Bearer ${bridge.token}`)).toBe(true);

  // Bridge chạy nhưng chưa đăng nhập Google → kết quả thật, không báo "đã kết nối"
  bridge.authenticated = false;
  await card.getByTestId("bridge-test").click();
  await expect(card.getByTestId("bridge-test-unauthenticated")).toContainText("chưa đăng nhập Google");
  bridge.authenticated = true;

  // Lưu → tải lại: token chỉ hiện dạng che, không có trong HTML
  await card.getByTestId("bridge-save").click();
  await expect(page.getByText("Đã lưu").first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("bridge-saved-badge")).toHaveText("Đã lưu cấu hình");
  await expect(page.getByTestId("bridge-url")).toHaveValue(bridge.url);
  expect(await page.content()).not.toContain(bridge.token);

  // Enterprise: đánh dấu Preview, nói rõ không có chat
  const ent = page.getByTestId("enterprise-card");
  await expect(ent).toContainText("Preview");
  await expect(ent).toContainText("không có endpoint hỏi đáp");

  // Google Drive: máy chủ e2e không có GOOGLE_CLIENT_ID → nói thẳng, không có nút kết nối lặp lỗi
  const drive = page.getByTestId("drive-card");
  await expect(drive.getByTestId("drive-state")).toHaveAttribute("data-state", "not_configured");
  await expect(drive.getByTestId("drive-not-configured-notice")).toContainText("GOOGLE_CLIENT_ID");
  await expect(drive.getByTestId("drive-connect")).toHaveCount(0);
});

test("kết nối notebook NotebookLM → hỏi đáp với kết nối → chip hiện nguồn ngoài → lưu ghi chú → nhập nguồn", async ({ page }) => {
  const origin = await signUp(page, "b");
  // Cấu hình Bridge qua API (đã kiểm thử ở test trên) để tập trung vào luồng notebook
  const put = await page.request.put(`${origin}/api/connectors/bridge`, {
    headers: { Origin: origin },
    data: { url: bridge.url, token: bridge.token, allowPrivateHosts: true },
  });
  expect(put.ok()).toBeTruthy();
  const nb = await page.request.post(`${origin}/api/notebooks`, { headers: { Origin: origin }, data: { title: `Sổ tay kết nối ${stamp}` } });
  const { notebook } = (await nb.json()) as { notebook: { id: string } };

  await page.goto(`/n/${notebook.id}`);
  const section = page.getByTestId("connections-section");
  await expect(section.getByTestId("connections-empty")).toBeVisible({ timeout: 30_000 });

  // Hộp thoại chọn notebook: liệt kê notebook thật của bridge
  await section.getByTestId("add-connection-button").click();
  const dialog = page.getByTestId("add-source-dialog");
  const list = dialog.getByTestId("external-notebooks");
  await expect(list.getByTestId("external-notebook")).toHaveCount(1);
  await list.getByTestId("external-notebook").filter({ hasText: "Giải phẫu ngoài" }).click();
  await dialog.getByTestId("connect-submit").click();

  // Thẻ kết nối: trạng thái THẬT 'ready' (server vừa gọi bridge), 2 nguồn
  const conn = section.getByTestId("connection-card");
  await expect(conn).toBeVisible();
  await expect(conn.getByTestId("connection-label")).toHaveText("Giải phẫu ngoài");
  await expect(conn.getByTestId("connection-provider")).toHaveText("NotebookLM Bridge");
  await expect(conn.getByTestId("connection-source-count")).toHaveText("2 nguồn");
  await expect(conn).toHaveAttribute("data-status", "ready");

  // Tab Google Drive trong "Thêm nguồn" nói rõ chưa cấu hình Google (không phải lỗi lặp)
  await page.getByTestId("add-source-button").click();
  await page.getByTestId("tab-drive").click();
  await expect(page.getByTestId("drive-not-configured")).toContainText("GOOGLE_CLIENT_ID");
  await page.keyboard.press("Escape");

  // Hỏi đáp: chọn kết nối trong popover phạm vi
  const chat = page.getByTestId("chat-panel");
  await chat.getByTestId("scope-button").click();
  const popover = page.getByTestId("scope-popover");
  await popover.getByTestId("scope-connection").click();
  await page.keyboard.press("Escape");
  await expect(chat.getByTestId("scope-button")).toContainText("+ 1 kết nối");

  const input = chat.getByTestId("chat-input");
  await input.fill("Tim có mấy buồng?");
  await input.press("Enter");
  const answer = chat.getByTestId("assistant-message");
  await expect(answer).toBeVisible({ timeout: 30_000 });
  expect(bridge.calls.some((c) => c.path === "/notebooks/ext-1/ask")).toBe(true);

  // Chip [1] trỏ nguồn ngoài: popover có trích đoạn, tên nguồn ngoài và liên kết mở NotebookLM
  const chip = answer.getByTestId("citation-chip").first();
  await expect(chip).toHaveAttribute("data-provider", "notebooklm-bridge", { timeout: 30_000 });
  await chip.click();
  const pop = page.getByTestId("external-citation-popover");
  await expect(pop.getByTestId("external-citation-title")).toHaveText("Giải phẫu tim");
  await expect(pop.getByTestId("external-citation-text")).toContainText("hai tâm nhĩ và hai tâm thất");
  await expect(pop.getByTestId("external-citation-link")).toHaveAttribute("href", "https://notebooklm.google.com/notebook/ext-1");
  await page.keyboard.press("Escape");
  const used = answer.getByTestId("sources-used").getByTestId("source-used");
  await expect(used.first()).toHaveAttribute("data-provider", "notebooklm-bridge");
  await expect(used.first()).toHaveAttribute("href", "https://notebooklm.google.com/notebook/ext-1");

  // Lưu câu trả lời vào NotebookLM (ghi ngược thật tới bridge)
  await answer.getByTestId("action-push-note").click();
  await expect(page.getByText("Đã lưu ghi chú vào NotebookLM").first()).toBeVisible();
  await expect.poll(() => bridge.notebooks.get("ext-1")!.notes.length).toBe(1);
  expect(bridge.notebooks.get("ext-1")!.notes[0].title).toBe("Tim có mấy buồng?");
  expect(bridge.notebooks.get("ext-1")!.notes[0].content).toContain("Tim có bốn buồng");

  // Nhập nguồn từ NotebookLM → nguồn text cục bộ → sẵn sàng
  await conn.getByTestId("connection-menu").click();
  await page.getByTestId("connection-import").click();
  const imp = page.getByTestId("import-connection-dialog");
  await imp.getByRole("checkbox", { name: "Giải phẫu tim" }).click();
  await imp.getByTestId("import-submit").click();
  await expect(imp.getByText("Đã nhập", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const card = page.getByTestId("source-card").filter({ hasText: "Giải phẫu tim" });
  await expect(card).toHaveAttribute("data-status", "ready", { timeout: 30_000 });

  // Chia sẻ với thành viên + gỡ kết nối
  await conn.getByTestId("connection-menu").click();
  await page.getByTestId("connection-share").click();
  await expect(page.getByText("Thành viên có thể hỏi đáp qua kết nối này")).toBeVisible();
  await expect(conn.getByText("chia sẻ", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await conn.getByTestId("connection-menu").click();
  await page.getByTestId("connection-remove").click();
  await page.getByTestId("connection-remove-confirm").click();
  await expect(section.getByTestId("connections-empty")).toBeVisible();
});
