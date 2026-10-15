import { NextResponse } from "next/server";
import { exportSlideDeckPptx } from "@/server/artifacts/slides/export-pptx";
import { renderSlideDeckHtml } from "@/server/artifacts/slides/render-html";
import { slideDeckSchema } from "@/server/artifacts/slides/types";

/** Route dev: xuất PPTX hoặc HTML in của deck gửi lên (chỉ môi trường dev). */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const body = (await req.json()) as { format?: string; content?: unknown };
  const parsed = slideDeckSchema.safeParse(body.content);
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid", message: parsed.error.message } }, { status: 400 });
  if (body.format === "pptx") {
    const buf = await exportSlideDeckPptx(parsed.data);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "Content-Disposition": 'attachment; filename="deck.pptx"' },
    });
  }
  // `pdf` ở dev trả HTML in (framework thật dùng Chromium để in PDF từ HTML này).
  return new NextResponse(renderSlideDeckHtml(parsed.data), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
