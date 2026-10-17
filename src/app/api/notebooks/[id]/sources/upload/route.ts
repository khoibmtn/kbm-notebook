import { ApiError, handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireNotebookRole } from "@/server/auth/permissions";
import { createSourceFromStoredFile, sourceTypeOrThrow, storedMimeFor, toSourceDto } from "@/server/knowledge/sources";
import { deleteStoredFile } from "@/server/storage/files";
import { discardFiles, receiveMultipart } from "@/server/storage/multipart";
import { sourceVisibilitySchema } from "@/lib/validators/sources";
import type { SourceDto } from "@/lib/sources";

type P = { id: string };

const MAX_FILES = 50;

/**
 * Tải lên một hoặc nhiều tệp (multipart, trường `files`, tuỳ chọn `visibility`) — editor+.
 * Body được đọc theo dòng thẳng xuống đĩa (không đệm vào RAM). Content-Length quá lớn → 413 trước khi đọc;
 * có hạn mức theo người dùng (429) và quota dung lượng sổ tay (413 `notebook_storage_full`).
 * Mỗi tệp được kiểm tra loại (MIME + đuôi) và kích thước (MAX_UPLOAD_MB → 413) riêng.
 * Có ít nhất một tệp thành công → 201 `{ sources, errors }`; không tệp nào thành công → mã lỗi của tệp đầu tiên lỗi.
 */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");

  const received = await receiveMultipart(req, {
    ownerId: user.id,
    notebookId: id,
    origin: "source_upload",
    maxFiles: MAX_FILES,
    tooManyMessage: `Tối đa ${MAX_FILES} tệp mỗi lần tải lên`,
    normalizeMime: (name, mime) => storedMimeFor(sourceTypeOrThrow(name, mime), mime),
    accept: ({ name, mime }) => {
      try {
        sourceTypeOrThrow(name, mime);
        return null;
      } catch (e) {
        return e as ApiError;
      }
    },
  });
  const errors = [...received.rejected];
  if (received.files.length === 0 && errors.length === 0) throw ApiError.badRequest("Chưa chọn tệp nào", "no_files");
  const visibility = sourceVisibilitySchema.catch("shared").parse(received.fields.visibility ?? "shared");

  const created: SourceDto[] = [];
  try {
    for (const f of received.files) {
      try {
        const type = sourceTypeOrThrow(f.name, f.mime);
        const row = await createSourceFromStoredFile({
          notebookId: id,
          userId: user.id,
          stored: f.row,
          name: f.name,
          type,
          visibility,
        });
        created.push(toSourceDto(row, { userId: user.id, role }));
      } catch (e) {
        await deleteStoredFile(f.row.id).catch(() => {});
        if (!(e instanceof ApiError)) throw e;
        errors.push({ name: f.name, status: e.status, code: e.code, message: e.message });
      }
    }
  } catch (e) {
    await discardFiles(received.files);
    throw e;
  }
  if (created.length === 0) {
    const first = errors[0];
    throw new ApiError(first.status, first.code, first.message, errors);
  }
  return Response.json({ sources: created, errors }, { status: 201 });
});
