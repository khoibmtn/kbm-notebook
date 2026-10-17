import { expect, test, type Page } from "@playwright/test";

const stamp = Date.now().toString(36);
const PASSWORD = "matkhau-e2e-123";

async function register(page: Page, name: string, email: string) {
  await page.goto("/register");
  await page.getByLabel("Họ và tên").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Nhập lại mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function sendMessage(page: Page, text: string) {
  const input = page.getByTestId("composer-input");
  await input.fill(text);
  await input.press("Enter");
}

test("hai người chat realtime: A gửi → B thấy ngay; B trả lời có @mention → A có chấm thông báo", async ({ browser }) => {
  test.setTimeout(120_000);
  const aliceEmail = `alice-${stamp}@example.com`;
  const bobEmail = `bob-${stamp}@example.com`;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  // Bob đăng ký trước để lời mời của Alice thêm thẳng vào sổ tay.
  await register(bob, "Bob Khách", bobEmail);
  await register(alice, "Alice Chủ", aliceEmail);

  await alice.getByRole("button", { name: "Tạo sổ tay" }).first().click();
  await alice.getByLabel("Tiêu đề").fill(`Nhóm chat ${stamp}`);
  await alice.getByRole("dialog").getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(alice).toHaveURL(/\/n\/[0-9a-f-]{36}$/);
  const notebookId = alice.url().split("/n/")[1];

  // Alice mời Bob (đã có tài khoản → được thêm ngay)
  await alice.getByRole("link", { name: "Thành viên" }).first().click();
  await alice.getByLabel("Email", { exact: true }).fill(bobEmail);
  await alice.getByRole("button", { name: "Mời", exact: true }).click();
  await expect(alice.getByTestId("member-list").getByText(bobEmail)).toBeVisible();

  // Cả hai mở trang Team
  await bob.goto(`/n/${notebookId}/team`);
  await alice.goto(`/n/${notebookId}/team`);
  await expect(bob.getByTestId("channel-title")).toHaveText("General");
  await expect(alice.getByTestId("channel-title")).toHaveText("General");
  await expect(bob.getByTestId("channel-empty")).toBeVisible();
  await bob.waitForTimeout(800); // chờ socket vào phòng kênh

  // 1) A gửi → B thấy mà không cần tải lại trang
  await sendMessage(alice, "Xin chào từ Alice");
  await expect(alice.getByTestId("message").filter({ hasText: "Xin chào từ Alice" })).toBeVisible();
  await expect(bob.getByTestId("message").filter({ hasText: "Xin chào từ Alice" })).toBeVisible();

  // Alice rời kênh sang trang Thành viên; Bob thả cảm xúc và trả lời có @mention
  await alice.getByRole("link", { name: "Thành viên" }).first().click();
  await expect(alice.getByTestId("member-list")).toBeVisible();

  const incoming = bob.getByTestId("message").filter({ hasText: "Xin chào từ Alice" });
  await incoming.hover();
  await incoming.getByRole("button", { name: "Trả lời" }).click();
  await expect(bob.getByTestId("composer-context")).toContainText("Trả lời Alice Chủ");

  const input = bob.getByTestId("composer-input");
  await input.pressSequentially("@Ali");
  await expect(bob.getByTestId("mention-popover")).toContainText("Alice Chủ");
  await input.press("Enter"); // chọn gợi ý đầu tiên (không gửi)
  await expect(input).toHaveValue("@Alice Chủ ");
  await input.pressSequentially("cảm ơn nhé");
  await input.press("Enter");

  const reply = bob.getByTestId("message").filter({ hasText: "cảm ơn nhé" });
  await expect(reply).toBeVisible();
  await expect(reply.getByTestId("reply-quote")).toContainText("Xin chào từ Alice");
  await expect(reply.locator("[data-mention]")).toHaveText("@Alice Chủ");

  // 2) Alice (đang ở trang khác) thấy chấm thông báo và badge chưa đọc ở mục Nhóm
  await expect(alice.getByTestId("notification-badge")).toHaveText("1", { timeout: 15_000 });
  await expect(alice.getByTestId("team-unread-badge")).toHaveText("1");

  await alice.getByTestId("notification-bell").click();
  const item = alice.getByTestId("notification-list").getByRole("button").first();
  await expect(item).toContainText("Bob Khách đã nhắc đến bạn");
  await item.click();

  // Bấm thông báo → mở đúng kênh, thấy tin trả lời, badge biến mất
  await expect(alice).toHaveURL(new RegExp(`/n/${notebookId}/team`));
  await expect(alice.getByTestId("message").filter({ hasText: "cảm ơn nhé" })).toBeVisible();
  await expect(alice.getByTestId("notification-badge")).toHaveCount(0, { timeout: 10_000 });
  await expect(alice.getByTestId("team-unread-badge")).toHaveCount(0, { timeout: 10_000 });

  // 3) Thả cảm xúc của Alice hiện ngay ở phía Bob
  const aliceView = alice.getByTestId("message").filter({ hasText: "cảm ơn nhé" });
  await aliceView.hover();
  await aliceView.getByRole("button", { name: "Thả cảm xúc" }).click();
  await alice.getByRole("button", { name: "👍" }).first().click();
  await expect(bob.getByTestId("message").filter({ hasText: "cảm ơn nhé" }).getByTestId("message-reactions")).toContainText("👍");

  // 4) Bob thu hồi tin → Alice thấy dấu "đã thu hồi" thay cho nội dung
  const bobReply = bob.getByTestId("message").filter({ hasText: "cảm ơn nhé" });
  await bobReply.hover();
  await bobReply.getByRole("button", { name: "Thêm hành động" }).click();
  await bob.getByRole("menuitem", { name: "Thu hồi" }).click();
  await bob.getByTestId("confirm-action").click();
  await expect(alice.getByTestId("message-recalled")).toBeVisible();
  await expect(alice.getByText("cảm ơn nhé")).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

test("DM không rò rỉ trên giao diện: người thứ ba không thấy cuộc trò chuyện riêng", async ({ browser }) => {
  test.setTimeout(120_000);
  const mk = async (name: string, email: string) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await register(page, name, email);
    return { ctx, page };
  };
  const carol = await mk("Carol Một", `carol-${stamp}@example.com`);
  const dave = await mk("Dave Hai", `dave-${stamp}@example.com`);
  const erin = await mk("Erin Ba", `erin-${stamp}@example.com`);

  await carol.page.getByRole("button", { name: "Tạo sổ tay" }).first().click();
  await carol.page.getByLabel("Tiêu đề").fill(`Sổ tay riêng ${stamp}`);
  await carol.page.getByRole("dialog").getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(carol.page).toHaveURL(/\/n\/[0-9a-f-]{36}$/);
  const notebookId = carol.page.url().split("/n/")[1];
  await carol.page.getByRole("link", { name: "Thành viên" }).first().click();
  for (const email of [`dave-${stamp}@example.com`, `erin-${stamp}@example.com`]) {
    await carol.page.getByLabel("Email", { exact: true }).fill(email);
    await carol.page.getByRole("button", { name: "Mời", exact: true }).click();
    await expect(carol.page.getByTestId("member-list").getByText(email)).toBeVisible();
  }

  await carol.page.goto(`/n/${notebookId}/team`);
  await carol.page.getByTestId("new-dm").click();
  await carol.page.getByRole("button", { name: /Dave Hai/ }).click();
  await expect(carol.page.getByTestId("channel-title")).toHaveText("Dave Hai");
  await sendMessage(carol.page, "chuyện riêng giữa Carol và Dave");
  await expect(carol.page.getByTestId("message").filter({ hasText: "chuyện riêng" })).toBeVisible();

  // Dave thấy DM trong danh sách (không cần tải lại) và đọc được tin
  await dave.page.goto(`/n/${notebookId}/team`);
  const daveDm = dave.page.getByTestId("channels-dms").getByTestId("channel-item");
  await expect(daveDm).toContainText("Carol Một");
  await daveDm.click();
  await expect(dave.page.getByTestId("message").filter({ hasText: "chuyện riêng" })).toBeVisible();

  // Erin (cùng sổ tay) không có DM nào và tìm kiếm không ra tin riêng
  await erin.page.goto(`/n/${notebookId}/team`);
  await expect(erin.page.getByTestId("channels-dms").getByTestId("channel-item")).toHaveCount(0);
  await erin.page.getByTestId("search-toggle").click();
  await erin.page.getByRole("button", { name: "Mọi kênh" }).click();
  await erin.page.getByTestId("search-input").fill("chuyện riêng");
  await expect(erin.page.getByTestId("search-results")).toContainText("Không tìm thấy tin nhắn nào");

  for (const u of [carol, dave, erin]) await u.ctx.close();
});

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("chủ đề, sửa bằng ↑, tệp đính kèm (ảnh + thẻ), chuyển vào Nguồn, tạo note từ tin đã chọn, tìm kiếm", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page, "Giảng Viên", `gv-${stamp}@example.com`);
  await page.getByRole("button", { name: "Tạo sổ tay" }).first().click();
  await page.getByLabel("Tiêu đề").fill(`Lớp học ${stamp}`);
  await page.getByRole("dialog").getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(page).toHaveURL(/\/n\/[0-9a-f-]{36}$/);
  const notebookId = page.url().split("/n/")[1];
  await page.goto(`/n/${notebookId}/team`);

  // Tạo chủ đề
  await page.getByTestId("create-topic").click();
  await page.getByTestId("topic-name").fill("Chương 3");
  await page.getByRole("dialog").getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(page.getByTestId("channel-title")).toHaveText("Chương 3");
  await expect(page.getByTestId("channels-topics").getByTestId("channel-item")).toContainText("Chương 3");

  // Gửi rồi bấm ↑ để sửa tin cuối của mình
  await sendMessage(page, "Bản đầu tiên");
  await expect(page.getByTestId("message").filter({ hasText: "Bản đầu tiên" })).toBeVisible();
  const input = page.getByTestId("composer-input");
  await input.press("ArrowUp");
  await expect(page.getByTestId("composer-context")).toContainText("Đang sửa tin nhắn");
  await expect(input).toHaveValue("Bản đầu tiên");
  await input.fill("Bản đã sửa xong");
  await input.press("Enter");
  const edited = page.getByTestId("message").filter({ hasText: "Bản đã sửa xong" });
  await expect(edited).toBeVisible();
  await expect(edited).toContainText("đã sửa");

  // Đính kèm một ảnh và một PDF
  await page.getByTestId("composer-file-input").setInputFiles([
    { name: "pixel.png", mimeType: "image/png", buffer: PIXEL_PNG },
    { name: "ghi-chu.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 demo") },
  ]);
  await expect(page.getByTestId("composer-uploads")).toContainText("pixel.png");
  await expect(page.getByTestId("composer-uploads")).toContainText("ghi-chu.pdf");
  await expect(page.getByTestId("composer-send")).toBeEnabled();
  await input.fill("Tài liệu buổi học");
  await page.getByTestId("composer-send").click();
  const withFiles = page.getByTestId("message").filter({ hasText: "Tài liệu buổi học" });
  await expect(withFiles).toBeVisible();
  const img = withFiles.locator('img[alt="pixel.png"]');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  await expect(withFiles.getByTestId("message-attachments")).toContainText("ghi-chu.pdf");

  // Chuyển tệp PDF vào Nguồn
  await withFiles.hover();
  await withFiles.getByRole("button", { name: "Chuyển vào Nguồn" }).click();
  await expect(page.getByText("Đã thêm 1 tệp vào Nguồn")).toBeVisible();

  // Chọn nhiều tin → tạo note
  await edited.hover();
  await edited.getByRole("button", { name: "Thêm hành động" }).click();
  await page.getByRole("menuitem", { name: "Tạo note từ tin nhắn" }).click();
  await expect(page.getByTestId("select-bar")).toContainText("Đã chọn 1 tin nhắn");
  await withFiles.click();
  await expect(page.getByTestId("select-bar")).toContainText("Đã chọn 2 tin nhắn");
  await page.getByTestId("create-note").click();
  await expect(page.getByText("Đã tạo note từ các tin nhắn đã chọn")).toBeVisible();
  await expect(page.getByTestId("select-bar")).toHaveCount(0);

  // Tìm kiếm trong kênh và nhảy tới kết quả
  await page.getByTestId("search-toggle").click();
  await page.getByTestId("search-input").fill("buổi học");
  const result = page.getByTestId("search-result");
  await expect(result).toHaveCount(1);
  await expect(result).toContainText("Tài liệu buổi học");
  await result.click();
  await expect(withFiles).toBeVisible();

  // Ghim: thanh ghim xuất hiện trên đầu
  await edited.hover();
  await edited.getByRole("button", { name: "Thêm hành động" }).click();
  await page.getByRole("menuitem", { name: "Ghim tin nhắn" }).click();
  await expect(page.getByTestId("pinned-bar")).toContainText("Bản đã sửa xong");
});

test("cuộn vô hạn lên trên, dải 'Tin nhắn mới', nút nhảy tới tin mới và dấu đã xem", async ({ browser }) => {
  test.setTimeout(150_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const aEmail = `scroll-a-${stamp}@example.com`;
  const bEmail = `scroll-b-${stamp}@example.com`;
  await register(b, "Bạn Gửi", bEmail);
  await register(a, "Bạn Đọc", aEmail);
  await a.getByRole("button", { name: "Tạo sổ tay" }).first().click();
  await a.getByLabel("Tiêu đề").fill(`Cuộn ${stamp}`);
  await a.getByRole("dialog").getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(a).toHaveURL(/\/n\/[0-9a-f-]{36}$/);
  const notebookId = a.url().split("/n/")[1];
  await a.getByRole("link", { name: "Thành viên" }).first().click();
  await a.getByLabel("Email", { exact: true }).fill(bEmail);
  await a.getByRole("button", { name: "Mời", exact: true }).click();
  await expect(a.getByTestId("member-list").getByText(bEmail)).toBeVisible();

  // B nạp sẵn 119 tin qua API (cùng cookie phiên của B; giới hạn gửi là 120 tin/phút nên tin "mới tới" ở dưới là tin thứ 120)
  const channels = await (await b.request.get(`/api/notebooks/${notebookId}/channels`)).json();
  const general = channels.channels.find((c: { type: string }) => c.type === "general").id as string;
  for (let i = 1; i <= 119; i++) {
    const res = await b.request.post(`/api/channels/${general}/messages`, { data: { kind: "text", content: `tin số ${i}` } });
    expect(res.status()).toBe(201);
  }

  // A mở kênh: thấy dải "Tin nhắn mới" và badge chưa đọc là 119 trước khi mở
  await a.goto(`/n/${notebookId}/team`);
  await expect(a.getByTestId("message-list")).toBeVisible();
  await expect(a.getByTestId("new-divider")).toBeVisible();
  await expect(a.getByTestId("message").filter({ hasText: "tin số 119" })).toBeVisible();

  // Cuộn lên đầu nhiều lần → nạp đủ 119 tin (keyset), không trùng lặp
  const list = a.getByTestId("message-list");
  await expect(async () => {
    await list.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(a.getByTestId("message")).toHaveCount(119, { timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  await expect(a.getByText("Đầu cuộc trò chuyện")).toBeVisible();
  await expect(a.getByText("tin số 1", { exact: true })).toBeVisible();

  // Đang ở phía trên: B gửi tin mới → A thấy nút "Tin nhắn mới (1)", bấm để nhảy xuống
  await expect(a.getByTestId("jump-latest")).toBeVisible();
  const res = await b.request.post(`/api/channels/${general}/messages`, { data: { kind: "text", content: "tin cuối cùng mới tới" } });
  expect(res.status()).toBe(201);
  await expect(a.getByTestId("jump-latest")).toContainText("Tin nhắn mới (1)");
  await a.getByTestId("jump-latest").click();
  await expect(a.getByTestId("message").filter({ hasText: "tin cuối cùng mới tới" })).toBeInViewport();

  // A đã đọc hết → B thấy dấu "đã xem" (avatar nhỏ) dưới tin cuối
  await b.goto(`/n/${notebookId}/team`);
  await expect(b.getByTestId("read-receipts")).toBeVisible({ timeout: 15_000 });

  await ctxA.close();
  await ctxB.close();
});

test("kéo thả tệp vào khung chat thêm tệp đính kèm vào ô soạn", async ({ page }) => {
  test.setTimeout(90_000);
  await register(page, "Người Kéo", `drag-${stamp}@example.com`);
  await page.getByRole("button", { name: "Tạo sổ tay" }).first().click();
  await page.getByLabel("Tiêu đề").fill(`Kéo thả ${stamp}`);
  await page.getByRole("dialog").getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(page).toHaveURL(/\/n\/[0-9a-f-]{36}$/);
  await page.goto(`${page.url()}/team`);
  await expect(page.getByTestId("composer-input")).toBeVisible();

  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["nội dung thả"], "thả-vào.txt", { type: "text/plain" }));
    return dt;
  });
  const area = page.getByTestId("message-list");
  await area.dispatchEvent("dragenter", { dataTransfer });
  await expect(page.getByTestId("drop-overlay")).toBeVisible();
  await area.dispatchEvent("drop", { dataTransfer });
  await expect(page.getByTestId("drop-overlay")).toHaveCount(0);
  await expect(page.getByTestId("composer-uploads")).toContainText("thả-vào.txt");
  await expect(page.getByTestId("composer-send")).toBeEnabled();
  await page.getByTestId("composer-send").click();
  await expect(page.getByTestId("message-attachments")).toContainText("thả-vào.txt");
});
