# 06 · Slide engine & Infographic engine

Module tự chứa (không DB, không route, không job handler): hàm server thuần + component React theo props. Framework Studio chỉ cần import các đường dẫn dưới đây.

## 1. Hợp đồng (framework import)

| Đường dẫn | Xuất |
|---|---|
| `src/server/artifacts/slides/types.ts` | `Slide`, `SlideLayout`, `SlideTheme`, `SlideDeckContent`, `slideDeckSchema` (zod), `slideDeckJsonSchema` (JSON Schema cho mô hình, **không có `evidence`**) |
| `src/server/artifacts/slides/generate.ts` | `generateSlideDeck`, `editSlideWithAi`, `SlideGenerationError` |
| `src/server/artifacts/slides/export-pptx.ts` | `exportSlideDeckPptx(content, { resolveImage? })` → `Buffer` |
| `src/server/artifacts/slides/render-html.ts` | `renderSlideDeckHtml(content, { resolveImageUrl?, includeSources?, locale? })` |
| `src/components/studio/slides/slide-editor.tsx` | `SlideEditor` |
| `src/components/studio/slides/slide-view.tsx` | `SlideView({ slide, theme, index, total, scale?, resolveImageUrl? })` |
| `src/server/artifacts/infographic/types.ts` | `InfographicContent`, `InfographicBlock`, `infographicSchema`, `infographicJsonSchema` |
| `src/server/artifacts/infographic/generate.ts` | `generateInfographic` |
| `src/server/artifacts/infographic/export.ts` | `exportInfographicSvg(content)`, `renderInfographicHtml(content)` |
| `src/components/studio/infographic/infographic-view.tsx` | `InfographicView({ content, onChange?, readOnly?, onEvidenceClick? })` |

Ghi chú tích hợp:

- `SlideEditor` có thêm props tuỳ chọn ngoài hợp đồng: `onImageUpload(slideId, file)` và `onImageGenerate(slideId, prompt)` (trả `{ fileId?, dataUrl? }`). Không truyền `onImageUpload` → ảnh tải lên được nhúng thành `image.dataUrl`; không truyền `onImageGenerate` → nút "Tạo ảnh" bị vô hiệu.
- `onEvidenceClick(evidenceIndex)` nhận **chỉ số 0-based** trong `content.evidence` (chip `[n]` → `n - 1`).
- `onAiEdit` có thể cập nhật `content` từ bên ngoài: editor coi đó là một bước lịch sử (undo được).
- `SlideEditor` cần được đặt trong khung có chiều cao xác định (`h-full`/`h-[calc(...)]`) từ `lg` trở lên; dưới `lg` các cột xếp dọc.
- Component dùng `useT()` (cần `I18nProvider` như phần còn lại của app); module i18n: `src/i18n/modules/slides.{vi,en}.ts`.
- Các tệp `types.ts`, `layouts.ts`, `ops.ts`, `themes.ts`, `chart-svg.ts`, `render-html.ts`, `sources.ts` **không** import `server-only` (component client dùng chung). `generate.ts`, `export-pptx.ts` có `server-only`.
- `export-pptx.ts` cần `pptxgenjs` ở `dependencies` (đã chuyển khỏi devDependencies) và thêm `@dnd-kit/*` cho editor.

### Provider mock (test/e2e của framework)

`generateSlideDeck`/`generateInfographic` với `provider.id === "mock"` mà đầu ra không hợp lệ (mock trả JSON tối thiểu rỗng) sẽ trả về bản **trích xuất xác định từ bằng chứng** (mỗi nguồn một slide `title_bullets`, kèm `citations`; infographic: stat từ các số `%` có thật trong nguồn + list). Không bịa nội dung; chỉ để luồng Studio chạy đầu-cuối khi `AI_PROVIDER=mock`. Provider thật (`gemini`) vẫn ném `SlideGenerationError` sau 2 lần thất bại.

## 2. Mô hình hình học (một nguồn sự thật)

`layouts.ts` → `layoutSlide(slide, theme, { index, total, edit })` trả về danh sách phần tử đã có toạ độ trong không gian **1280×720 px**: `shape | text | bullets | image | chart | table | slideNumber | citations`, kèm cỡ chữ đã tính, màu hex, khoảng cách bullet, độ rộng cột/chiều cao hàng bảng.

Ba nơi tiêu thụ cùng một danh sách:

1. `SlideView` (React/CSS, `data-key` = khoá phần tử) — canvas editor, thumbnail, trình chiếu.
2. `renderSlideDeckHtml` (HTML in): mỗi slide là một `<section class="page">` 1280×720, `@page { size: 1280px 720px; margin: 0 }`, `print-color-adjust: exact`.
3. `exportSlideDeckPptx`: `LAYOUT_WIDE` (13.333×7.5 in) và **inch = px / 96**, pt = px × 0.75.

Quyết định bố cục nằm hết trong `layouts.ts` nên ba đầu ra khớp: cỡ chữ tự co (ước lượng ngắt dòng theo bề rộng ký tự trung bình của font, tối thiểu theo từng loại), cột hai/ba, thẻ co theo nội dung, cột bảng theo độ dài nội dung, v.v. Test `hình học dùng chung` so khoá + toạ độ giữa HTML in, React và `layoutSlide`; test PPTX đối chiếu toạ độ EMU từng phần tử với `layoutSlide`.

9 layout: `title`, `section`, `title_bullets`, `two_column` (1–3 cột), `image_text`, `chart` (kèm bullets bên cạnh tuỳ chọn), `quote`, `table`, `closing` (có/không bullets). 6 palette (`indigo`, `emerald`, `rose`, `amber`, `slate`, `ocean`) và 4 font (`Inter`, `Roboto`, `Georgia`, `Arial`) trong `themes.ts`.

Slide "Nguồn" (`sources.ts`): nếu có slide nào trích dẫn, PPTX và HTML in thêm slide cuối liệt kê `[n] tiêu đề — trang/mục/URL` (tối đa 7 nguồn/slide, tự chia trang). Slide này **không** nằm trong `content.slides` và không hiện trong editor; tắt ở HTML bằng `includeSources: false`.

## 3. Sinh nội dung (prompt trong `prompts.ts`)

`generateSlideDeck` — 2 giai đoạn, mỗi giai đoạn validate bằng zod + kiểm tra theo layout; sai → **thử lại đúng 1 lần** với danh sách lỗi nối vào prompt; vẫn sai → ném `SlideGenerationError`.

1. **Dàn ý** (`slideOutlineJsonSchema`): tiêu đề, palette, các phần, danh sách slide `{ layout, title, purpose, section, citations }`.
   - `slideCount` số → đúng N slide (kiểm tra cứng, tối đa 80).
   - `'auto'` → gợi ý 10–25 theo độ dài ngữ cảnh (`autoSlideCountTarget`), **không có trần cứng 15**: prompt cho phép nhiều hơn khi nội dung đòi hỏi và code không cắt bớt.
2. **Nội dung** (`slideDeckJsonSchema`): trường theo từng layout (bullet ≤ 7 từ ở `concise`, ≤ 12 từ ở `detailed`, tối đa 6 bullet; `notes` 2–4 câu; `image.prompt` tiếng Anh cho `image_text`; chart/table từ số liệu thật).

Hậu kiểm: chuẩn hoá chuỗi/bullet, cắt > 6 bullet, chuẩn hoá hàng bảng theo số cột, pie chỉ 1 series, **bỏ số trích dẫn không có trong evidence** (`sanitizeCitations`), gán `id`, gắn `evidence`. Lỗi cứng: thiếu dữ liệu layout cần, `values` ≠ `labels`, sai số slide. Lỗi mềm (chỉ kích hoạt lần thử lại, không chặn kết quả): thiếu `notes`; nguồn có số liệu (`hasNumericData`) mà chưa có slide chart/table.

`editSlideWithAi` chỉ viết lại một slide: gửi slide hiện tại (không kèm ảnh nhúng), tiêu đề các slide khác để giữ mạch và (tuỳ chọn) ngữ cảnh nguồn; giữ `id`; giữ ảnh/`fileId` nếu `image.prompt` không đổi; giữ `citations`/`notes` cũ nếu mô hình không trả; mọi slide khác, theme, evidence giữ nguyên.

### Ảnh

`options.includeImages` + `provider.generateImage` → tối đa `options.maxImages` (mặc định 4) slide `image_text` nhận ảnh dưới dạng **`image.dataUrl`**. Framework **phải lưu ảnh vào kho tệp, thay bằng `image.fileId` và xoá `dataUrl`** trước khi ghi `artifact_versions.content` (tránh phình JSON). Ảnh lỗi bị bỏ qua êm (slide giữ `image.prompt`). Provider không có `generateImage` (mock) → bỏ qua. Khi hiển thị, `fileId` được đổi sang URL qua `resolveImageUrl`; khi xuất PPTX qua `resolveImage` (Buffer).

## 4. Xuất PPTX — độ trung thực

Đối tượng gốc, chỉnh sửa được trong PowerPoint/LibreOffice:

- Hộp chữ thật (tiêu đề, phụ đề, trích dẫn), bullet thật (`<a:buChar>` với thụt lề treo), nền và hình trang trí là shape.
- Biểu đồ **native** (`addChart` bar/line/pie), bảng **native** (`addTable`, hàng tiêu đề tô màu, hàng so le).
- Ảnh (`addImage`, đọc kích thước từ header PNG/JPEG/GIF/WebP rồi cắt kiểu "cover" vào khung), `addNotes` cho ghi chú diễn giả, số trang là trường gốc (`slidenum`).
- `lang = vi-VN` cho từng hộp chữ.

Kiểm chứng trong test: unzip kiểm `<a:t>` tiêu đề, `<a:buChar>`, `<a:tbl>`, `<c:barChart|lineChart|pieChart>`, notesSlides, `sldSz 12192000×6858000`; `soffice --headless --convert-to pdf` rồi dùng `unpdf` đếm trang = số slide (+ slide Nguồn).

Khác biệt đã biết so với HTML/React: bullet cùng màu chữ (pptxgenjs không đặt được màu bullet); ảnh không bo góc (chỉ HTML bo 16px); font không có trên máy mở file sẽ bị thay (LibreOffice thay Georgia bằng font serif rộng hơn → chữ có thể dài hơn một chút); ước lượng ngắt dòng dùng bề rộng ký tự trung bình nên có thể lệch ±1 dòng với từng font cụ thể.

## 5. Editor (`SlideEditor`)

- Cột trái: thumbnail (kéo sắp xếp bằng `@dnd-kit`, Space nhấc/thả bằng bàn phím, nút nhân bản/xoá, "Thêm slide" chọn layout), ↑/↓ chuyển slide, Delete xoá khi focus thumbnail.
- Giữa: canvas co giãn vừa khung, sửa trực tiếp mọi phần tử chữ (contentEditable, dán chỉ lấy văn bản thuần; bullet: Enter tách/thêm, Backspace ở dòng trống xoá; Esc huỷ; mỗi lần sửa là một bước undo), sửa ô bảng ngay trên canvas.
- Phải: đổi layout, số cột, dữ liệu biểu đồ (nhãn/chuỗi/giá trị, loại bar/line/pie), bảng, mô tả + tạo/tải ảnh, ghi chú diễn giả, trích dẫn (bấm → `onEvidenceClick`, thêm/bỏ), "Sửa slide này bằng AI".
- Thanh công cụ: bảng màu, phông chữ, bộ đếm slide, undo/redo (⌘Z, ⌘⇧Z, Ctrl+Y), trình chiếu toàn màn hình (←/→/Space/Esc), xuất (`onExport('pptx'|'pdf')`).
- `readOnly`: chỉ xem, trình chiếu, xuất và bấm trích dẫn.

Trang xem thử dev: `/dev/slides` và `/dev/infographic` (404 ở production). Dữ liệu từ `sample-deck.json` / `sample-infographic.json` — **fixture dev có nhãn rõ ràng**, không phải dữ liệu sản phẩm; `/dev/slides/export` (POST) xuất PPTX/HTML cho kiểm thử thủ công.

## 6. Infographic

Khối: `stat`, `list`, `process`, `compare`, `icon_text`, `chart`, `quote` (+ `id`, `citations`, `span?`); `palette` dùng chung 6 bảng màu slide; `orientation` `portrait` (1080×1920) hoặc `landscape` (1920×1080).

- **Không bịa số liệu**: prompt cấm; code kiểm chứng — mọi dãy số trong `stat.value` và mọi giá trị `chart` phải xuất hiện trong ngữ cảnh/evidence (chấp nhận khác định dạng: `42,5` / `42.5`, `1.500` / `1500`; chỉ mục `[n]` không tính là số liệu). `stat`/`chart` bắt buộc có ≥ 1 trích dẫn hợp lệ. Sai → thử lại 1 lần kèm lỗi → ném lỗi. Số trích dẫn không có trong evidence bị bỏ; khối thiếu `citations` là lỗi mềm.
- **Dàn trang** (`infographic/layout.ts`): lưới 2 cột (dọc) / 3 cột (ngang), mỗi loại khối có số cột mặc định (process full; compare/chart/quote 2 cột), đóng gói theo hàng có "lấp chỗ trống" (nhìn trước 4 khối), khối cuối giãn để không còn ô trống, thẻ giãn đều khi còn dư chỗ, nội dung căn giữa theo chiều dọc khi thẻ bị giãn. Process nằm ngang khi đủ rộng. Chân trang liệt kê nguồn đã trích dẫn.
- **Vừa canvas**: nếu dài hơn canvas danh định, dàn lại với hệ số thu nhỏ 0.9 → 0.7 (chữ nhỏ hơn, vẫn đọc được); vẫn dài thì **chiều cao tăng thêm** (chiều rộng luôn 1080/1920).
- `exportInfographicSvg`: SVG tự chứa (không `href`/ảnh ngoài/script), chữ ngắt dòng sẵn bằng `<tspan>`, biểu tượng lucide (30 biểu tượng nhúng trong `icons.ts`), biểu đồ vẽ bằng `chart-svg.ts`; `font-family` có chuỗi dự phòng (**không nhúng tệp phông**). `renderInfographicHtml`: HTML một trang đúng kích thước cho Chromium chụp PNG/in PDF.
- `InfographicView`: cùng bộ dàn trang; sửa trực tiếp chữ/giá trị (xoá trắng một mục danh sách = bỏ mục), đổi bảng màu, chip trích dẫn.

## 7. Giới hạn đã biết

- `imageFileId` của infographic được lưu nhưng chưa được vẽ (chưa có luồng ảnh nền/hero).
- Infographic: không thêm/xoá/sắp xếp khối bằng giao diện (chỉ sửa chữ/giá trị, bảng màu); dữ liệu biểu đồ chỉ sửa qua nội dung (chưa có bảng sửa trong view); văn bản tuỳ chọn còn trống (caption, attribution) chưa có ô gợi ý để thêm.
- Slide: không có chuyển cảnh/hoạt ảnh, không đối tượng tự do (kéo thả vị trí) — mọi phần tử thuộc layout; biểu đồ không xuất dạng ảnh cho PDF (PDF dùng SVG của HTML in).
- PPTX: xem mục 4 (màu bullet, bo góc ảnh, thay font). Không có chủ đề/master tuỳ biến; số trang tắt ở slide `title`.
- Ước lượng ngắt dòng không phải đo thật: văn bản cực dài trong khung nhỏ có thể tràn vài px trước khi cỡ chữ tối thiểu được áp dụng.
- Nhiều editor trong cùng một trang chưa được hỗ trợ (phím tắt undo/redo gắn ở cấp tài liệu).
