import { ApiError, handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireNotebookRole } from "@/server/auth/permissions";
import { assertPublicUrl } from "@/server/knowledge/ingest/ssrf";
import { IngestError } from "@/server/knowledge/ingest/errors";
import { createSourceFromText, createSourceFromUrl, listSources, toSourceDto } from "@/server/knowledge/sources";
import { createSourceSchema } from "@/lib/validators/sources";

type P = { id: string };

/** Danh sách nguồn mà user được xem (shared + nguồn riêng của chính họ). */
export const GET = handleRoute<P>(async (_req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "viewer");
  return { sources: await listSources(id, { userId: user.id, role }) };
});

/** Thêm nguồn từ URL hoặc văn bản dán (editor+). Tệp tải lên dùng `POST /sources/upload`. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  const input = await parseBody(createSourceSchema, req);
  const viewer = { userId: user.id, role };

  if (input.kind === "url") {
    try {
      await assertPublicUrl(input.url);
    } catch (e) {
      // Chỉ chặn khi chắc chắn là địa chỉ nội bộ/không hợp lệ; lỗi DNS tạm thời để job ingest tự xử lý.
      if (e instanceof IngestError && e.permanent) throw ApiError.badRequest(e.message, "blocked_url");
      if (!(e instanceof IngestError)) throw e;
    }
    const row = await createSourceFromUrl({ notebookId: id, userId: user.id, url: input.url, visibility: input.visibility });
    return Response.json({ source: toSourceDto(row, viewer) }, { status: 201 });
  }
  const row = await createSourceFromText({
    notebookId: id,
    userId: user.id,
    title: input.title,
    text: input.text,
    visibility: input.visibility,
  });
  return Response.json({ source: toSourceDto(row, viewer) }, { status: 201 });
});
