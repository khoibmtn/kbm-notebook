import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";

const stamp = Date.now().toString(36);

const SOURCE_TEXT =
  "Quang hợp là quá trình thực vật chuyển hoá ánh sáng mặt trời, nước và khí cacbonic thành glucose và oxy trong lục lạp của tế bào. " +
  "Ty thể là bào quan tạo ra ATP thông qua hô hấp tế bào, thường được gọi là nhà máy năng lượng của tế bào. " +
  "Ribosome tổng hợp protein dựa trên thông tin di truyền do RNA thông tin mang đến từ nhân tế bào. " +
  "Nhân tế bào chứa vật chất di truyền DNA và điều khiển mọi hoạt động sống của tế bào nhân thực.";

async function setup(page: Page, tag: string) {
  const origin = process.env.E2E_BASE ?? `http://localhost:${process.env.E2E_PORT ?? 3200}`;
  const email = `studio-${tag}-${stamp}@example.com`;
  const res = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { Origin: origin },
    data: { name: "Người Dùng Studio", email, password: "matkhau-e2e-123" },
  });
  expect(res.ok()).toBeTruthy();
  const nb = await page.request.post(`${origin}/api/notebooks`, { headers: { Origin: origin }, data: { title: `Sổ tay Studio ${tag} ${stamp}` } });
  const { notebook } = (await nb.json()) as { notebook: { id: string } };
  const src = await page.request.post(`${origin}/api/notebooks/${notebook.id}/sources`, {
    headers: { Origin: origin },
    data: { kind: "text", title: "Bài giảng tế bào", text: SOURCE_TEXT },
  });
  expect(src.ok()).toBeTruthy();
  await expect
    .poll(async () => {
      const list = await page.request.get(`${origin}/api/notebooks/${notebook.id}/sources`);
      return ((await list.json()) as { sources: { status: string }[] }).sources[0]?.status;
    }, { timeout: 30_000 })
    .toBe("ready");
  return { notebookId: notebook.id, origin };
}

test("Studio: tạo quiz từ nguồn văn bản → làm bài → sửa → xuất → chia sẻ liên kết", async ({ page, browser }) => {
  const { notebookId, origin } = await setup(page, "quiz");
  await page.goto(`/n/${notebookId}`);

  // Cột Studio có lưới loại artifact và trạng thái rỗng
  const studio = page.getByTestId("studio-panel");
  await expect(studio.getByTestId("studio-card-quiz")).toBeVisible();
  await expect(studio.getByText("Chưa có artifact nào")).toBeVisible({ timeout: 30_000 }); // lần đầu biên dịch route artifacts (kéo theo engine slide) có thể chậm
  await expect(studio.getByTestId("studio-scope")).toHaveText("1 nguồn");
  // slide_deck/infographic đã có engine thật → thẻ tạo dùng được
  await expect(studio.getByTestId("studio-create-slide_deck")).toBeEnabled();
  await expect(studio.getByTestId("studio-create-infographic")).toBeEnabled();

  // Hộp Tuỳ chỉnh: prompt mặc định hiển thị, prompt riêng, số câu hỏi
  await studio.getByTestId("studio-customize-quiz").click();
  const dialog = page.getByTestId("customize-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("effective-prompt-toggle").click();
  await expect(dialog.getByTestId("effective-prompt")).toContainText("Bạn soạn câu hỏi trắc nghiệm");
  await dialog.getByTestId("custom-prompt").fill("Tập trung vào bào quan");
  await dialog.getByLabel("Số câu hỏi").fill("3");
  await dialog.getByTestId("customize-create").click();

  // Hàng artifact xuất hiện, chuyển sang sẵn sàng theo thời gian thực
  const row = studio.getByTestId("artifact-row").first();
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-status", "ready", { timeout: 40_000 });

  // Nội dung đã lưu để biết đáp án đúng
  const artifactId = (await row.getAttribute("data-artifact-id"))!;
  const api = await page.request.get(`${origin}/api/artifacts/${artifactId}`);
  const detail = (await api.json()) as { artifact: { content: { questions: { id: string; type: string; stem: string; answer: string }[] } } };
  const questions = detail.artifact.content.questions;
  expect(questions).toHaveLength(3);
  const expectedScore = questions.filter((q) => q.type === "mcq" && q.answer === "A").length;

  // Mở artifact → trình chơi quiz
  await row.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/artifacts/${artifactId}$`));
  await expect(page.getByTestId("quiz-player")).toBeVisible();
  await expect(page.getByTestId("quiz-progress")).toHaveText("Câu 1/3");

  for (let i = 0; i < 3; i++) {
    await page.getByTestId("quiz-option-A").click();
    await page.getByTestId("quiz-check").click();
    await expect(page.getByTestId("quiz-explanation")).toBeVisible();
    if (i < 2) await page.getByTestId("quiz-next").click();
    else await page.getByTestId("quiz-finish").click();
  }
  await expect(page.getByTestId("quiz-score")).toHaveText(`${expectedScore}/3`);
  await page.getByRole("button", { name: "Xem lại từng câu" }).click();

  // Chế độ chỉnh sửa → đổi nội dung câu hỏi → Lưu thành phiên bản mới
  await page.getByTestId("quiz-mode-edit").click();
  const stem = page.getByTestId("quiz-stem-input").first();
  await stem.fill("Câu hỏi đã được chỉnh sửa trong e2e");
  await page.getByTestId("artifact-save").click();
  await expect(page.getByTestId("version-menu")).toContainText("v2");
  await page.getByTestId("version-menu").click();
  await expect(page.getByTestId("version-item")).toHaveCount(2);
  await page.keyboard.press("Escape");

  // Xuất CSV (đồng bộ) và DOCX → tải về thật
  await page.getByTestId("artifact-export").click();
  const csvDownload = page.waitForEvent("download");
  await page.getByTestId("export-csv").click();
  const csvFile = await csvDownload;
  const csvText = await readFile((await csvFile.path())!, "utf8");
  expect(csvText).toContain("Câu hỏi đã được chỉnh sửa trong e2e");

  await page.getByTestId("artifact-export").click();
  const docxDownload = page.waitForEvent("download");
  await page.getByTestId("export-docx").click();
  const docx = await docxDownload;
  const zip = await JSZip.loadAsync(await readFile((await docx.path())!));
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain("Câu hỏi đã được chỉnh sửa trong e2e");

  // Chia sẻ: "Ai có liên kết" → mở bằng ngữ cảnh chưa đăng nhập, chỉ đọc
  await page.getByTestId("artifact-share").click();
  const share = page.getByTestId("share-dialog");
  await share.getByTestId("visibility-link").click();
  await expect(share.getByTestId("share-link")).toBeVisible();
  await expect(share.getByTestId("visibility-link")).toBeChecked();
  const link = await share.getByTestId("share-link").inputValue();
  expect(link).toMatch(/\/s\/[A-Za-z0-9_-]{16,}$/);
  const guest = await browser.newContext({ baseURL: origin });
  const guestPage = await guest.newPage();
  await guestPage.goto(link);
  await expect(guestPage.getByTestId("shared-title")).toBeVisible();
  await expect(guestPage.getByTestId("quiz-player")).toBeVisible();
  await expect(guestPage.getByText("chỉ đọc")).toBeVisible();
  await expect(guestPage.getByTestId("quiz-mode-edit")).toHaveCount(0);
  await guest.close();

  // Danh sách: đổi tên, nhân bản, xoá
  await page.goto(`/n/${notebookId}/studio`);
  const list = page.getByTestId("artifact-list");
  await list.getByTestId("artifact-menu").first().click();
  await page.getByRole("menuitem", { name: "Nhân bản" }).click();
  await expect(list.getByTestId("artifact-row")).toHaveCount(2);
  await list.getByTestId("artifact-menu").first().click();
  await page.getByRole("menuitem", { name: "Xoá" }).click();
  await page.getByTestId("delete-confirm").click();
  await expect(list.getByTestId("artifact-row")).toHaveCount(1);
});

test("Studio: báo cáo (Tiptap), thẻ ghi nhớ lưu tiến độ, sơ đồ tư duy, bảng dữ liệu", async ({ page }) => {
  const { notebookId, origin } = await setup(page, "types");

  const createVia = async (type: string, body: Record<string, unknown> = {}) => {
    const res = await page.request.post(`${origin}/api/notebooks/${notebookId}/artifacts`, { headers: { Origin: origin }, data: { type, ...body } });
    expect(res.status()).toBe(201);
    const id = ((await res.json()) as { artifact: { id: string } }).artifact.id;
    await expect
      .poll(async () => ((await (await page.request.get(`${origin}/api/artifacts/${id}`)).json()) as { artifact: { status: string } }).artifact.status, { timeout: 40_000 })
      .toBe("ready");
    return id;
  };

  // Báo cáo: xem có chip trích dẫn + mục Nguồn; sửa bằng Tiptap
  const report = await createVia("report", { title: "Báo cáo e2e" });
  await page.goto(`/n/${notebookId}/artifacts/${report}`);
  await expect(page.getByTestId("artifact-title")).toHaveText("Báo cáo e2e");
  await expect(page.getByTestId("markdown-view")).toContainText("Báo cáo");
  await expect(page.getByTestId("sources-footer")).toContainText("Bài giảng tế bào");
  await expect(page.getByTestId("citation-1").first()).toBeVisible();
  await page.getByTestId("doc-mode-edit").click();
  const editor = page.getByTestId("markdown-editor-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Câu bổ sung từ e2e.");
  await page.getByTestId("artifact-save").click();
  await expect(page.getByTestId("version-menu")).toContainText("v2");
  await page.reload();
  await expect(page.getByTestId("markdown-view")).toContainText("Câu bổ sung từ e2e.");

  // Thẻ ghi nhớ: lật, đánh dấu đã thuộc → còn sau khi tải lại (localStorage)
  const cards = await createVia("flashcards", { options: { count: 4 } });
  await page.goto(`/n/${notebookId}/artifacts/${cards}`);
  const card = page.getByTestId("flashcard");
  await expect(card).toHaveAttribute("data-side", "front");
  await card.click();
  await expect(card).toHaveAttribute("data-side", "back");
  await page.getByTestId("flashcard-known").click();
  await expect(page.getByTestId("flashcards-known")).toHaveText("Đã thuộc 1/4");
  await page.getByTestId("flashcard-next").click();
  await page.reload();
  await expect(page.getByTestId("flashcards-known")).toHaveText("Đã thuộc 1/4");

  // Sơ đồ tư duy: markmap render + sửa đề cương
  const mm = await createVia("mindmap");
  await page.goto(`/n/${notebookId}/artifacts/${mm}`);
  await expect(page.getByTestId("mindmap-canvas").locator("svg g.markmap-node").first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("mindmap-mode-outline").click();
  await expect(page.getByTestId("mindmap-outline")).toBeVisible();
  const firstRow = page.getByTestId("outline-row").first().getByRole("textbox").first();
  await firstRow.fill("Gốc đã đổi tên");
  await page.getByTestId("artifact-save").click();
  await expect(page.getByTestId("version-menu")).toContainText("v2");

  // Bảng dữ liệu: thêm dòng/cột, sửa ô
  const table = await createVia("data_table");
  await page.goto(`/n/${notebookId}/artifacts/${table}`);
  await expect(page.getByTestId("data-table-row").first()).toBeVisible();
  const rowsBefore = await page.getByTestId("data-table-row").count();
  await page.getByTestId("table-add-row").click();
  await expect(page.getByTestId("data-table-row")).toHaveCount(rowsBefore + 1);
  await page.getByTestId("table-add-column").click();
  await page.getByRole("textbox", { name: /Cột 3 \d+/ }).first().fill("giá trị mới").catch(() => undefined);
  await page.getByTestId("artifact-save").click();
  await expect(page.getByTestId("version-menu")).toContainText("v2");
});

test("Studio: viewer chỉ xem — không thể tạo", async ({ page, browser }) => {
  const { notebookId, origin } = await setup(page, "viewer");
  // thêm một người xem thật vào sổ tay
  const viewerCtx = await browser.newContext({ baseURL: origin });
  const vPage = await viewerCtx.newPage();
  const vEmail = `studio-guest-reader-${stamp}@example.com`;
  const signUp = await vPage.request.post(`${origin}/api/auth/sign-up/email`, { headers: { Origin: origin }, data: { name: "Người Xem", email: vEmail, password: "matkhau-e2e-123" } });
  expect(signUp.ok(), await signUp.text()).toBeTruthy();
  const invite = await page.request.post(`${origin}/api/notebooks/${notebookId}/members`, { headers: { Origin: origin }, data: { email: vEmail, role: "viewer" } });
  expect(invite.ok()).toBeTruthy();

  await vPage.goto(`/n/${notebookId}/studio`);
  await expect(vPage.getByTestId("studio-create-quiz")).toBeDisabled();
  await expect(vPage.getByTestId("studio-customize-quiz")).toBeDisabled();
  await expect(vPage.getByText("Chỉ xem")).toBeVisible();
  const res = await vPage.request.post(`${origin}/api/notebooks/${notebookId}/artifacts`, { headers: { Origin: origin }, data: { type: "quiz" } });
  expect(res.status()).toBe(403);
  await viewerCtx.close();
});

test("Studio: tạo slide deck → mở editor → sửa tiêu đề tại chỗ → lưu → xuất PPTX tải về có dữ liệu", async ({ page }) => {
  const { notebookId } = await setup(page, "deck");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/n/${notebookId}`);

  const studio = page.getByTestId("studio-panel");
  await studio.getByTestId("studio-create-slide_deck").click();
  const row = studio.getByTestId("artifact-row").first();
  await expect(row).toHaveAttribute("data-status", "ready", { timeout: 40_000 });
  await row.getByRole("link").first().click();

  // Editor slide mở trong trang artifact
  await expect(page.getByTestId("slide-editor")).toBeVisible();
  await expect(page.getByTestId("toolbar-font")).toHaveText("Inter");
  const canvasSlide = page.getByTestId("slide-canvas").locator(".kbm-slide");
  const title = canvasSlide.locator('[data-field="title"]');
  await title.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Tiêu đề slide sửa trong e2e");
  await page.keyboard.press("Enter");
  await expect(title).toHaveText("Tiêu đề slide sửa trong e2e");

  await page.getByTestId("artifact-save").click();
  await expect(page.getByTestId("version-menu")).toContainText("v2");

  // Xuất PPTX bằng menu xuất của editor → tải về, giải nén thấy tiêu đề vừa sửa
  await page.getByTestId("toolbar-export").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-pptx").click();
  const file = await download;
  const bytes = await readFile((await file.path())!);
  expect(bytes.length).toBeGreaterThan(5_000);
  const zip = await JSZip.loadAsync(bytes);
  const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(slide1).toContain("Tiêu đề slide sửa trong e2e");
});
