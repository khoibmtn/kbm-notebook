import { expect, test, type Browser, type Page } from "@playwright/test";

const stamp = Date.now().toString(36);

const SOURCE_TEXT =
  "Quang hợp là quá trình thực vật chuyển hoá ánh sáng mặt trời, nước và khí cacbonic thành glucose và oxy trong lục lạp của tế bào. " +
  "Ty thể là bào quan tạo ra ATP thông qua hô hấp tế bào, thường được gọi là nhà máy năng lượng của tế bào.";

const origin = () => process.env.E2E_BASE ?? `http://localhost:${process.env.E2E_PORT ?? 3200}`;
const headers = () => ({ Origin: origin() });

async function signUp(page: Page, name: string, tag: string) {
  const res = await page.request.post(`${origin()}/api/auth/sign-up/email`, {
    headers: headers(),
    data: { name, email: `comm-${tag}-${stamp}@example.com`, password: "matkhau-e2e-123" },
  });
  expect(res.ok()).toBeTruthy();
}

async function newUserPage(browser: Browser, name: string, tag: string) {
  const context = await browser.newContext({ baseURL: origin(), locale: "vi-VN", viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await signUp(page, name, tag);
  return { context, page };
}

async function createNotebook(page: Page, title: string) {
  const nb = await page.request.post(`${origin()}/api/notebooks`, { headers: headers(), data: { title } });
  return ((await nb.json()) as { notebook: { id: string } }).notebook.id;
}

async function addReadySource(page: Page, notebookId: string) {
  await page.request.post(`${origin()}/api/notebooks/${notebookId}/sources`, { headers: headers(), data: { kind: "text", title: "Bài giảng tế bào", text: SOURCE_TEXT } });
  await expect
    .poll(async () => ((await (await page.request.get(`${origin()}/api/notebooks/${notebookId}/sources`)).json()) as { sources: { status: string }[] }).sources[0]?.status, { timeout: 30_000 })
    .toBe("ready");
}

async function createReadyArtifact(page: Page, notebookId: string, type: string, title: string) {
  const art = await page.request.post(`${origin()}/api/notebooks/${notebookId}/artifacts`, { headers: headers(), data: { type, title } });
  const id = ((await art.json()) as { artifact: { id: string } }).artifact.id;
  await expect
    .poll(async () => ((await (await page.request.get(`${origin()}/api/artifacts/${id}`)).json()) as { artifact: { status: string } }).artifact.status, { timeout: 45_000 })
    .toBe("ready");
  return id;
}

test("Explore: mở artifact công khai → thích → bình luận (markdown); số liệu hiện trên thẻ", async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = await newUserPage(browser, "Chủ Công Khai", "own1");
  const nbId = await createNotebook(owner.page, `Sổ tay riêng ${stamp}`);
  await addReadySource(owner.page, nbId);
  const title = `Báo cáo cộng đồng ${stamp}`;
  const artifactId = await createReadyArtifact(owner.page, nbId, "report", title);
  const share = await owner.page.request.patch(`${origin()}/api/artifacts/${artifactId}/share`, { headers: headers(), data: { visibility: "public" } });
  expect(share.ok()).toBeTruthy();

  const guest = await newUserPage(browser, "Bạn Đọc", "read1");
  const page = guest.page;
  await page.goto("/");
  await page.getByTestId("nav-explore").click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByRole("heading", { name: "Khám phá" })).toBeVisible();

  await page.getByTestId("explore-search").fill(title);
  const card = page.getByTestId("explore-artifact-card").filter({ hasText: title });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Sổ tay riêng");
  await expect(card).toContainText("Chủ Công Khai");
  // lọc loại: quiz → không có
  await page.getByTestId("explore-type").selectOption("quiz");
  await expect(card).toHaveCount(0);
  await page.getByTestId("explore-type").selectOption("");
  await expect(card).toHaveCount(1);

  await card.click();
  await expect(page).toHaveURL(new RegExp(`/a/${artifactId}$`));
  await expect(page.getByTestId("shared-title")).toHaveText(title);
  await expect(page.getByTestId("artifact-social")).toBeVisible();
  await expect(page.getByTestId("like-count")).toHaveText("0");

  await page.getByTestId("like-button").click();
  await expect(page.getByTestId("like-count")).toHaveText("1");
  await expect(page.getByTestId("like-button")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("comment-input").fill("Bài rất **hữu ích**, cảm ơn bạn!");
  await page.getByTestId("comment-submit").click();
  const item = page.getByTestId("comment-item");
  await expect(item).toHaveCount(1);
  await expect(item.locator("strong")).toHaveText("hữu ích");
  await expect(page.getByTestId("comment-count")).toContainText("1");

  // tải lại: trạng thái được lưu thật; thẻ ở Explore phản ánh số liệu
  await page.reload();
  await expect(page.getByTestId("like-count")).toHaveText("1");
  await expect(page.getByTestId("comment-item")).toHaveCount(1);
  await page.goto(`/explore`);
  await page.getByTestId("explore-search").fill(title);
  await expect(page.getByTestId("explore-artifact-card").filter({ hasText: title })).toContainText("1");

  // xoá bình luận của chính mình
  await page.goto(`/a/${artifactId}`);
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("comment-item").getByRole("button", { name: "Xoá bình luận" }).click();
  await expect(page.getByTestId("comment-item")).toHaveCount(0);

  // khách chưa đăng nhập: xem được, không thể thích/bình luận
  const anon = await browser.newContext({ baseURL: origin(), locale: "vi-VN" });
  const anonPage = await anon.newPage();
  await anonPage.goto(`/a/${artifactId}`);
  await expect(anonPage.getByTestId("shared-title")).toHaveText(title);
  await expect(anonPage.getByTestId("like-button")).toBeDisabled();
  await expect(anonPage.getByRole("link", { name: "Đăng nhập để thích và bình luận." })).toBeVisible();
  await expect(anonPage.getByTestId("comment-input")).toHaveCount(0);

  await Promise.all([owner.context.close(), guest.context.close(), anon.close()]);
});

test("tìm kiếm toàn cục từ ⌘K → trang /search → mở kết quả (ghi chú, nguồn); điều hướng bàn phím", async ({ browser }) => {
  test.setTimeout(120_000);
  const u = await newUserPage(browser, "Người Tìm Kiếm", "srch1");
  const page = u.page;
  const nbId = await createNotebook(page, `Sổ tay tìm kiếm ${stamp}`);
  await addReadySource(page, nbId);
  const tag = `kiwi${stamp}`;
  const note = await page.request.post(`${origin()}/api/notebooks/${nbId}/notes`, {
    headers: headers(),
    data: { title: "Ghi chú trái cây", contentMd: `Danh sách mua sắm có quả ${tag} và vài thứ khác.` },
  });
  const noteId = ((await note.json()) as { note: { id: string } }).note.id;

  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+K");
  await page.getByTestId("palette-input").fill(tag);
  await page.getByTestId("palette-search-all").click();
  await expect(page).toHaveURL(new RegExp(`/search\\?q=${tag}`));
  const results = page.getByTestId("search-results");
  await expect(results).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("search-group-notes")).toContainText("Ghi chú trái cây");
  await expect(page.getByTestId("search-group-notes").locator("mark")).toHaveText(tag);
  await page.getByTestId("search-result").first().click();
  await expect(page).toHaveURL(new RegExp(`/n/${nbId}/notes\\?note=${noteId}`));
  await expect(page.getByTestId("note-title")).toHaveValue("Ghi chú trái cây", { timeout: 30_000 });

  // nội dung nguồn → đoạn trích có đánh dấu, mở Source viewer đúng đoạn; bàn phím ↓ + Enter
  await page.goto("/search");
  await page.getByTestId("search-input").fill("ATP");
  const sourceGroup = page.getByTestId("search-group-sources");
  await expect(sourceGroup).toBeVisible({ timeout: 20_000 });
  await expect(sourceGroup.locator("mark").first()).toHaveText(/ATP/i);
  await page.getByTestId("search-input").press("ArrowDown").catch(() => undefined);
  await page.getByTestId("search-input").press("ArrowUp");
  await page.getByTestId("search-input").press("Enter");
  await expect(page).toHaveURL(new RegExp(`/n/${nbId}/sources/[0-9a-f-]{36}\\?chunk=[0-9a-f-]{36}`));
  await expect(page.getByTestId("source-viewer")).toBeVisible({ timeout: 30_000 });

  // không có kết quả
  await page.goto("/search?q=khongcogihetxyzabc");
  await expect(page.getByText("Không có kết quả cho “khongcogihetxyzabc”")).toBeVisible({ timeout: 20_000 });
  await u.context.close();
});

test("sổ tay công khai: bật công khai trong Cài đặt → trang /p/slug không lộ nguồn → yêu cầu tham gia → chủ duyệt → thành viên", async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = await newUserPage(browser, "Chủ Sổ Tay Mở", "pub-own");
  const op = owner.page;
  const title = `Sổ tay mở ${stamp}`;
  const nbId = await createNotebook(op, title);
  await addReadySource(op, nbId);
  await op.request.patch(`${origin()}/api/notebooks/${nbId}`, { headers: headers(), data: { description: "Mô tả công khai của sổ tay" } });
  const artifactId = await createReadyArtifact(op, nbId, "report", `Bài công khai ${stamp}`);
  await op.request.patch(`${origin()}/api/artifacts/${artifactId}/share`, { headers: headers(), data: { visibility: "public" } });

  // Chủ sổ tay bật công khai bằng giao diện Cài đặt sổ tay
  await op.setViewportSize({ width: 1440, height: 900 });
  await op.goto(`/n/${nbId}/settings`);
  const card = op.getByTestId("publish-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("KHÔNG bao giờ được công khai");
  const slugInput = card.getByTestId("publish-slug");
  await expect(slugInput).toHaveValue(/^so-tay-mo-/);
  const slug = await slugInput.inputValue();
  await card.getByTestId("publish-toggle").click();
  await expect(card.getByTestId("publish-view")).toBeVisible();

  // Khách (chưa đăng nhập) xem trang công khai: thấy tiêu đề/mô tả/artifact công khai, KHÔNG thấy nguồn
  const anon = await browser.newContext({ baseURL: origin(), locale: "vi-VN" });
  const ap = await anon.newPage();
  await ap.goto(`/p/${slug}`);
  await expect(ap.getByTestId("public-title")).toHaveText(title);
  await expect(ap.getByText("Mô tả công khai của sổ tay")).toBeVisible();
  await expect(ap.getByTestId("public-artifacts")).toContainText(`Bài công khai ${stamp}`);
  await expect(ap.getByText("Bài giảng tế bào")).toHaveCount(0);
  await expect(ap.getByText("Quang hợp")).toHaveCount(0);
  await expect(ap.getByTestId("join-login")).toBeVisible();
  await anon.close();

  // Người lạ đăng nhập gửi yêu cầu
  const guest = await newUserPage(browser, "Người Xin Vào", "pub-guest");
  const gp = guest.page;
  await gp.goto(`/p/${slug}`);
  await gp.getByTestId("join-request").click();
  await gp.getByTestId("join-message").fill("Cho em tham gia học chung ạ");
  await gp.getByTestId("join-send").click();
  await expect(gp.getByTestId("join-pending")).toBeVisible();
  // người lạ chưa được vào sổ tay
  const denied = await gp.request.get(`${origin()}/api/notebooks/${nbId}/sources`);
  expect(denied.status()).toBe(404);

  // Chủ nhận thông báo (realtime) → mở trang Thành viên → chấp nhận
  await op.goto(`/`);
  await expect(op.getByTestId("notification-badge")).toBeVisible({ timeout: 20_000 });
  await op.getByTestId("notification-bell").click();
  await op.getByText("muốn tham gia sổ tay").first().click();
  await expect(op).toHaveURL(new RegExp(`/n/${nbId}/members\\?requests=1`));
  const req = op.getByTestId("join-request-item");
  await expect(req).toHaveCount(1, { timeout: 20_000 });
  await expect(req).toContainText("Người Xin Vào");
  await expect(req).toContainText("Cho em tham gia học chung ạ");
  await req.getByTestId("join-accept").click();
  await expect(op.getByTestId("join-requests")).toHaveCount(0);
  await expect(op.getByTestId("member-list")).toContainText("Người Xin Vào");

  // Khách giờ là thành viên (Người xem): trang công khai báo đã tham gia, truy cập được sổ tay
  await gp.reload();
  await expect(gp.getByText("Bạn đã là thành viên của sổ tay này")).toBeVisible();
  const ok = await gp.request.get(`${origin()}/api/notebooks/${nbId}/sources`);
  expect(ok.status()).toBe(200);
  await gp.getByRole("link", { name: "Mở sổ tay" }).click();
  await expect(gp).toHaveURL(new RegExp(`/n/${nbId}$`));

  // Explore liệt kê sổ tay công khai
  await gp.goto("/explore?tab=notebooks");
  await gp.getByTestId("explore-search").fill(title);
  await expect(gp.getByTestId("explore-notebook-card").filter({ hasText: title })).toHaveCount(1);

  await Promise.all([owner.context.close(), guest.context.close()]);
});

test("nhóm học tập: tạo nhóm công khai → người khác tham gia → liên kết sổ tay", async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await newUserPage(browser, "Chủ Nhóm", "grp-own");
  const op = owner.page;
  const nbTitle = `Sổ tay của nhóm ${stamp}`;
  await createNotebook(op, nbTitle);

  await op.goto("/explore?tab=groups");
  await op.getByTestId("explore-create-group").click();
  const name = `Nhóm ôn thi ${stamp}`;
  await op.getByTestId("group-name").fill(name);
  await op.getByLabel("Mô tả").fill("Nhóm học tập thử nghiệm");
  await op.getByTestId("group-create-submit").click();
  await expect(op).toHaveURL(/\/g\/nhom-on-thi-/);
  await expect(op.getByTestId("group-title")).toContainText(name);
  await expect(op.getByTestId("group-member-count")).toContainText("1 thành viên");

  // liên kết sổ tay
  await op.getByTestId("group-notebook-pick").selectOption({ label: nbTitle });
  await op.getByTestId("group-notebook-link").click();
  await expect(op.getByTestId("group-notebooks")).toContainText(nbTitle);

  // người khác tham gia nhóm mở: thấy sổ tay bị khoá? (không phải thành viên sổ tay → ẩn với người chưa vào nhóm)
  const other = await newUserPage(browser, "Bạn Cùng Học", "grp-join");
  const gp = other.page;
  const url = op.url();
  await gp.goto(url);
  await expect(gp.getByTestId("group-title")).toContainText(name);
  await expect(gp.getByTestId("group-notebooks")).toHaveCount(0);
  await gp.getByTestId("group-join").click();
  await expect(gp.getByTestId("group-members")).toContainText("Bạn Cùng Học", { timeout: 20_000 });
  // đã là thành viên nhóm nhưng không phải thành viên sổ tay → chỉ thấy tiêu đề kèm ổ khoá
  await expect(gp.getByTestId("group-notebooks")).toContainText(nbTitle);
  await expect(gp.getByTestId("group-notebooks")).toContainText("Bạn chưa là thành viên sổ tay này");
  await expect(gp.getByTestId("group-notebooks").getByRole("link")).toHaveCount(0);

  await Promise.all([owner.context.close(), other.context.close()]);
});
