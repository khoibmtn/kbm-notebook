"use client";
import { t } from "@/lib/i18n";

/** Ranh giới lỗi cuối cùng (lỗi trong layout gốc): không có provider nên dùng `t()` thuần với ngôn ngữ mặc định. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="vi">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", margin: 0, padding: 24, textAlign: "center" }}>
        <div role="alert">
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>{t("error.title")}</h1>
          <p style={{ color: "#555", marginBottom: 16 }}>{t("error.description")}</p>
          {error.digest && <p style={{ color: "#777", fontSize: 12 }}>{t("error.digest", { digest: error.digest })}</p>}
          <button type="button" onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}>
            {t("error.retry")}
          </button>
        </div>
      </body>
    </html>
  );
}
