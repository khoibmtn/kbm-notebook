/** Chuỗi giao diện cho các biện pháp bảo mật (xác minh email, nguồn riêng tư…). Được trải vào `vi`. */
export const securityVi = {
  "studio.share.privateSourcesOnly": "Artifact này được tạo từ nguồn riêng tư nên chỉ có thể ở chế độ Riêng tư. Tạo lại từ các nguồn chia sẻ nếu muốn chia sẻ.",
  "studio.privateSourcesBadge": "Chứa nguồn riêng tư",
  "email.verify.subject": "Xác minh email KBM Notebook",
  "email.verify.body": "Xin chào {name},\n\nHãy mở liên kết sau để xác minh địa chỉ email của bạn (liên kết có hiệu lực 24 giờ):\n{url}\n\nNếu bạn không đăng ký KBM Notebook, hãy bỏ qua email này.",
  "auth.verify.banner": "Email của bạn chưa được xác minh. Cho đến khi xác minh, bạn chưa thể tham gia sổ tay qua lời mời hay nhận artifact được chia sẻ theo email.",
  "auth.verify.resend": "Gửi lại email xác minh",
  "auth.verify.sent": "Đã gửi email xác minh tới {email}. Hãy kiểm tra hộp thư.",
  "auth.verify.resendFailed": "Không gửi lại được email xác minh. Thử lại sau ít phút.",
  "auth.verify.registered": "Chúng tôi đã gửi email xác minh tới {email}.",
  "invite.verifyFirst": "Bạn cần xác minh email {email} trước khi tham gia sổ tay. Mở email xác minh đã gửi cho bạn rồi quay lại trang này.",
  "security.chat.noCitations": "Câu trả lời này không trích dẫn nguồn nào nên chưa thể kiểm chứng. Hãy xem lại cẩn thận hoặc đặt câu hỏi cụ thể hơn, gắn với nội dung trong nguồn.",
} as const;
