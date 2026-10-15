import { ApiError, handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireNotebookRole } from "@/server/auth/permissions";
import { createSourceFromFile, toSourceDto } from "@/server/knowledge/sources";
import { sourceVisibilitySchema } from "@/lib/validators/sources";
import type { SourceDto } from "@/lib/sources";

type P = { id: string };

/**
 * Tải lên một hoặc nhiều tệp (multipart, trường `files`, tuỳ chọn `visibility`) — editor+.
 * Mỗi tệp được kiểm tra loại (MIME + đuôi) và kích thước (MAX_UPLOAD_MB → 413) riêng.
 * Có ít nhất một tệp thành công → 201 `{ sources, errors }`; không tệp nào thành công → mã lỗi của tệp đầu tiên lỗi.
 */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw ApiError.badRequest("Yêu cầu phải là multipart/form-data", "invalid_form");
  }
  const files = [...form.getAll("files"), ...form.getAll("file")].filter((v): v is File => typeof v !== "string");
  if (files.length === 0) throw ApiError.badRequest("Chưa chọn tệp nào", "no_files");
  if (files.length > 50) throw ApiError.badRequest("Tối đa 50 tệp mỗi lần tải lên", "too_many_files");
  const visibility = sourceVisibilitySchema.catch("shared").parse(form.get("visibility") ?? "shared");

  const created: SourceDto[] = [];
  const errors: { name: string; status: number; code: string; message: string }[] = [];
  for (const file of files) {
    try {
      const row = await createSourceFromFile({ notebookId: id, userId: user.id, file, visibility });
      created.push(toSourceDto(row, { userId: user.id, role }));
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      errors.push({ name: file.name, status: e.status, code: e.code, message: e.message });
    }
  }
  if (created.length === 0) {
    const first = errors[0];
    throw new ApiError(first.status, first.code, first.message, errors);
  }
  return Response.json({ sources: created, errors }, { status: 201 });
});
