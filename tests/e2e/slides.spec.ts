import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import JSZip from "jszip";

const stamp = Date.now().toString(36);

/** Đăng ký người dùng qua API (trang /dev nằm trong nhóm (app) cần phiên đăng nhập). */
async function signUp(page: Page, tag: string) {
  const origin = process.env.E2E_BASE ?? `http://localhost:${process.env.E2E_PORT ?? 3200}`;
  const res = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { Origin: origin },
    data: { name: "Slide Tester", email: `slides-${tag}-${stamp}@example.com`, password: "matkhau-e2e-123" },
  });
  expect(res.ok()).toBeTruthy();
}

async function openEditor(page: Page, tag: string) {
  await signUp(page, tag);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/slides");
  await expect(page.getByTestId("slide-editor")).toBeVisible();
  await expect(page.getByTestId("dev-banner")).toContainText("DEV FIXTURE");
  // chờ hydrate xong (Select phông chữ chỉ có chữ sau khi React chạy phía client)
  await expect(page.getByTestId("toolbar-font")).toHaveText("Inter");
}

const thumbs = (page: Page) => page.getByTestId("slide-thumb");
const thumbTitles = async (page: Page) =>
  (await thumbs(page).locator("[role=button]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))).map((l) => l.replace(/^Slide \d+: /, ""));
const canvasSlide = (page: Page) => page.getByTestId("slide-canvas").locator(".kbm-slide");

test("editor: hiển thị bộ slide, sửa tiêu đề trực tiếp, undo/redo, ảnh chụp giao diện", async ({ page }) => {
  await openEditor(page, "edit");
  await expect(thumbs(page)).toHaveCount(11);
  await expect(page.getByTestId("slide-counter")).toContainText("Slide 1 / 11");
  await page.screenshot({ path: "test-results/slides-01-editor.png" });

  // chọn slide 2 (tiêu đề + ý chính) và sửa tiêu đề tại chỗ
  await thumbs(page).nth(1).locator("[role=button]").click();
  await expect(canvasSlide(page)).toHaveAttribute("data-layout", "title_bullets");
  const title = canvasSlide(page).locator('[data-field="title"]');
  await title.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Tiêu đề đã sửa trực tiếp");
  await page.keyboard.press("Enter");
  await expect(title).toHaveText("Tiêu đề đã sửa trực tiếp");
  expect((await thumbTitles(page))[1]).toBe("Tiêu đề đã sửa trực tiếp");
  await page.screenshot({ path: "test-results/slides-02-edited-title.png" });

  // undo / redo bằng nút và phím tắt
  await page.getByTestId("toolbar-undo").click();
  await expect(title).toHaveText("Vì sao cần chuyển dịch?");
  await page.getByTestId("toolbar-redo").click();
  await expect(title).toHaveText("Tiêu đề đã sửa trực tiếp");
  await page.getByTestId("slide-canvas").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("ControlOrMeta+Z");
  await expect(title).toHaveText("Vì sao cần chuyển dịch?");
});

test("editor: bullet — Enter thêm, Backspace ở dòng trống xoá, dán chỉ lấy văn bản thuần", async ({ page }) => {
  await openEditor(page, "bullets");
  await thumbs(page).nth(1).locator("[role=button]").click();
  const bullets = canvasSlide(page).locator('[data-field^="bullets."]');
  await expect(bullets).toHaveCount(4);
  await bullets.nth(3).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(bullets).toHaveCount(5);
  await page.keyboard.type("Ý mới thêm");
  await expect(bullets.nth(4)).toHaveText("Ý mới thêm");
  // xoá hết chữ rồi Backspace trên dòng trống → xoá bullet
  for (let i = 0; i < "Ý mới thêm".length; i++) await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(bullets).toHaveCount(4);
  // sau commit (blur) số bullet của slide cập nhật
  await page.getByTestId("slide-canvas").click({ position: { x: 4, y: 4 } });
  await expect(bullets).toHaveCount(4);
});

test("editor: thêm/xoá/nhân bản slide, đổi layout, kéo sắp xếp, phím ↑/↓", async ({ page }) => {
  await openEditor(page, "structure");
  // thêm slide trích dẫn sau slide đầu
  await page.getByTestId("slide-add").click();
  await page.getByTestId("add-layout-quote").click();
  await expect(thumbs(page)).toHaveCount(12);
  await expect(page.getByTestId("slide-counter")).toContainText("Slide 2 / 12");
  await expect(canvasSlide(page)).toHaveAttribute("data-layout", "quote");
  await canvasSlide(page).locator('[data-field="quote.text"]').click();
  await page.keyboard.type("Một câu trích dẫn thử nghiệm");
  await page.keyboard.press("Enter");
  await page.screenshot({ path: "test-results/slides-03-new-quote.png" });

  // đổi layout sang hai cột
  await page.getByTestId("layout-two_column").click();
  await expect(canvasSlide(page)).toHaveAttribute("data-layout", "two_column");
  await expect(canvasSlide(page).locator('[data-field="columns.1.heading"]')).toBeVisible();

  // nhân bản rồi xoá bản sao
  await thumbs(page).nth(1).hover();
  await thumbs(page).nth(1).getByTestId("slide-duplicate").click();
  await expect(thumbs(page)).toHaveCount(13);
  await thumbs(page).nth(2).hover();
  await thumbs(page).nth(2).getByTestId("slide-delete").click();
  await expect(thumbs(page)).toHaveCount(12);

  // phím mũi tên chuyển slide khi focus ở thumbnail
  await thumbs(page).nth(0).locator("[role=button]").click();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("slide-counter")).toContainText("Slide 2 / 12");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("slide-counter")).toContainText("Slide 1 / 12");

  // kéo slide 4 xuống sau slide 6 (dnd-kit PointerSensor)
  const before = await thumbTitles(page);
  const src = await thumbs(page).nth(3).locator("[role=button]").boundingBox();
  const dst = await thumbs(page).nth(5).locator("[role=button]").boundingBox();
  if (!src || !dst) throw new Error("không tìm thấy thumbnail");
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2 + 20, { steps: 4 });
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2 + 10, { steps: 12 });
  await page.mouse.up();
  const after = await thumbTitles(page);
  expect(after).not.toEqual(before);
  expect(after.indexOf(before[3])).toBeGreaterThan(3);
  expect([...after].sort()).toEqual([...before].sort());

  // undo hoàn lại thứ tự
  await page.getByTestId("toolbar-undo").click();
  expect(await thumbTitles(page)).toEqual(before);
});

test("editor: dữ liệu biểu đồ, bảng, theme, ghi chú, trích dẫn, sửa bằng AI, trình chiếu", async ({ page }) => {
  await openEditor(page, "panel");
  // biểu đồ (slide 4)
  await thumbs(page).nth(3).locator("[role=button]").click();
  await expect(canvasSlide(page)).toHaveAttribute("data-layout", "chart");
  const cell = page.getByTestId("chart-cell-0-0");
  await cell.fill("40");
  await cell.blur();
  await expect(canvasSlide(page).locator("svg text", { hasText: /^40$/ }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/slides-04-chart.png" });

  // bảng (slide 8): sửa ô trực tiếp trên canvas
  await thumbs(page).nth(7).locator("[role=button]").click();
  await expect(canvasSlide(page)).toHaveAttribute("data-layout", "table");
  const c = canvasSlide(page).locator('[data-field="table.rows.0.0"]');
  await c.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Quang điện");
  await page.keyboard.press("Enter");
  await expect(c).toHaveText("Quang điện");
  await page.screenshot({ path: "test-results/slides-05-table.png" });

  // theme: đổi bảng màu + phông
  await page.getByTestId("toolbar-palette").click();
  await page.getByTestId("palette-emerald").click();
  await page.keyboard.press("Escape");
  await expect(canvasSlide(page).locator('[data-key="accent-bar"]')).toHaveCSS("background-color", "rgb(5, 150, 105)");
  await page.screenshot({ path: "test-results/slides-06-emerald.png" });

  // ghi chú diễn giả + trích dẫn
  await thumbs(page).nth(1).locator("[role=button]").click();
  const notes = page.getByTestId("notes-input");
  await notes.fill("Ghi chú mới cho diễn giả.");
  await notes.blur();
  await thumbs(page).nth(2).locator("[role=button]").click();
  await thumbs(page).nth(1).locator("[role=button]").click();
  await expect(notes).toHaveValue("Ghi chú mới cho diễn giả.");
  await page.getByTestId("panel-citation-1").click();
  await expect(page.getByTestId("evidence-clicked")).toContainText("evidence #0");
  await canvasSlide(page).getByTestId("citation-chip-1").click();

  // sửa bằng AI (handler dev)
  await page.getByTestId("ai-instruction").fill("rút gọn");
  await page.getByTestId("ai-run").click();
  await expect(canvasSlide(page).locator('[data-field="title"]')).toContainText("[dev-ai: rút gọn]");

  // trình chiếu
  await page.getByTestId("toolbar-present").click();
  await expect(page.getByTestId("presenter")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("presenter-counter")).toHaveText("4 / 11");
  await page.screenshot({ path: "test-results/slides-07-presenter.png" });
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("presenter-counter")).toHaveText("3 / 11");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presenter")).toBeHidden();
  await expect(page.getByTestId("slide-counter")).toContainText("Slide 3 / 11");
});

test("editor: xuất PPTX chứa hộp chữ thật (text box + notes) từ deck đang sửa", async ({ page }) => {
  await openEditor(page, "export");
  await thumbs(page).nth(0).locator("[role=button]").click();
  const title = canvasSlide(page).locator('[data-field="title"]');
  await title.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Bản xuất kiểm thử");
  await page.keyboard.press("Enter");

  const [download] = await Promise.all([page.waitForEvent("download"), (async () => {
    await page.getByTestId("toolbar-export").click();
    await page.getByTestId("export-pptx").click();
  })()]);
  const file = await download.path();
  const buf = fs.readFileSync(file);
  expect(buf.subarray(0, 2).toString()).toBe("PK");
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain("<a:t>Bản xuất kiểm thử</a:t>");
  expect(Object.keys(zip.files).some((n) => n.startsWith("ppt/notesSlides/"))).toBe(true);
});

test("editor: chỉ đọc không cho sửa & bố cục hẹp (di động) không tràn ngang", async ({ page }) => {
  await openEditor(page, "mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/slides");
  await expect(page.getByTestId("slide-editor")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/slides-08-mobile.png", fullPage: true });
});
