# 05 · Ngôn ngữ thiết kế UI (dùng chung cho mọi module)

## Nguyên tắc
1. **Tối giản, mật độ thông tin cao, không trang trí thừa.** Bề mặt trắng/xám rất nhạt, viền 1px `border`, bo góc 10–12px, bóng nhẹ chỉ cho popover/dialog.
2. **3 cột NotebookLM**: Sources (320px, thu gọn 56px) · Main (chat/notes/editor, linh hoạt) · Studio (360px, thu gọn 56px). < 1024px: thành tab dưới cùng (Sources · Chat · Studio). Lưu trạng thái cột trong `localStorage`.
3. **Trích dẫn là công dân hạng nhất**: chip `[n]` dạng pill nhỏ, hover hiện tooltip trích đoạn + tên nguồn + trang, click mở Source viewer cuộn đúng đoạn và highlight.
4. **Trạng thái thật**: mọi thao tác async có skeleton/spinner, toast (`sonner`) khi lỗi/thành công, empty-state có hành động chính. Không bao giờ hiển thị số liệu giả.
5. **Bàn phím**: `⌘K` command palette (tìm notebook/nguồn/artifact), `Enter` gửi, `Shift+Enter` xuống dòng, `Esc` đóng, `↑` sửa tin nhắn cuối (team chat).

## Token (Tailwind v4 `@theme` trong `globals.css`)
- Màu nhấn `--color-primary: oklch(0.55 0.17 262)` (indigo-blue, giống NotebookLM), `--color-primary-foreground: white`; thành công `oklch(0.62 0.17 150)`; cảnh báo `oklch(0.75 0.16 75)`; lỗi `oklch(0.6 0.2 25)`.
- Nền: `background` trắng / dark `oklch(0.17 0.01 262)`; `muted` `oklch(0.97 0.005 262)`; `card` trắng; `border` `oklch(0.91 0.005 262)`.
- Chữ: Inter (Google Fonts via `next/font`), `text-sm` mặc định (14px), tiêu đề 18–22px, chat/document 15px với `leading-relaxed`.
- Icon: lucide, 16–18px.
- Mỗi notebook có `emoji` + `cover_color` (8 màu pastel định sẵn) dùng cho thẻ và header.

## Mẫu thành phần
- **Thẻ nguồn** (Sources): checkbox chọn · icon loại (PDF/DOCX/URL/TXT/YouTube) · tiêu đề 1 dòng · phụ đề (số trang · trạng thái) · menu ⋯ (đổi tên, xem, private/shared, xoá). Thanh trên: "Thêm nguồn" (dialog kéo thả nhiều tệp, URL, dán text, từ Drive, từ NotebookLM), "Chọn tất cả".
- **Khung chat AI**: tin người dùng căn phải nền `muted`; tin AI căn trái, markdown render (GFM, bảng, code), chip `[n]`; dưới tin AI: hàng nút (Lưu note · Lưu cặp Q&A · Sao chép · Tạo lại); cuối: "Nguồn đã dùng" dạng danh sách gọn. Ô nhập: textarea auto-grow, nút chọn phạm vi nguồn (n nguồn · kết nối · web), nút gửi; gợi ý câu hỏi khi trống.
- **Studio**: lưới nút loại artifact (icon + tên + mô tả 1 dòng) → bấm = tạo nhanh, biểu tượng ✎ = mở hộp "Tuỳ chỉnh" (prompt mặc định hiển thị, prompt riêng, options theo loại, phạm vi nguồn, model). Dưới: danh sách artifact đã tạo (icon, tên, thời gian, trạng thái, menu: mở, đổi tên, nhân bản, chia sẻ, xuất, xoá).
- **Slide editor**: trái thumbnails (kéo sắp xếp, thêm/xoá/nhân bản), giữa canvas 16:9 (chỉnh text trực tiếp từng phần tử, đổi layout, đổi ảnh/chart), phải: speaker notes + trích dẫn + "Sửa bằng AI" cho slide này. Toolbar: theme/palette, xuất PPTX/PDF, chia sẻ, phiên bản.
- **Team chat** (Telegram/Zalo): danh sách kênh trái (General, chủ đề, DM; badge chưa đọc; tìm kiếm), khung tin nhắn gộp theo người gửi & thời gian, bong bóng, hover hiện hành động (trả lời, reaction, sửa, thu hồi, ghim, chuyển vào Sources, tạo note), quote tin trả lời, mention `@` với popup thành viên, emoji picker, đính kèm (preview ảnh, thẻ tệp), thẻ artifact/nguồn/note (xem nhanh), "đang nhập…", dấu đã xem (avatar nhỏ), thanh tìm kiếm trong kênh, ghim trên đầu.
- **Dark mode**: `next-themes`, class `dark`, token đổi tương ứng.

## Responsive
- ≥1280: 3 cột đầy đủ. 1024–1279: Studio thu gọn mặc định. <1024: tab. Mobile: thanh dưới 4 tab (Sources · Chat · Studio · Team), header gọn.
