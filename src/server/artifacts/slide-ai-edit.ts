import "server-only";
import { z } from "zod";
import { getAiProviderForUser, getUserModels } from "@/server/ai";
import { buildContext } from "@/server/ai/context";
import type { AiProvider } from "@/server/ai/provider";
import { ApiError } from "@/server/api/errors";
import type { Evidence } from "@/server/knowledge/providers/types";
import { t } from "@/lib/i18n";
import { contentSchemaFor } from "@/lib/artifacts/content";
import { getSlideEngine, type SlideDeckContent } from "./registry";
import { addVersion, requireEdit, type ArtifactAccess } from "./service";
import { db } from "@/server/db";
import { artifactVersions } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const slideAiEditSchema = z.object({
  instruction: z.string().trim().min(1, "Hãy nhập chỉ dẫn chỉnh sửa").max(2000),
  /** Phiên bản client đang xem; lệch với phiên bản hiện tại → 409. */
  baseVersionId: z.string().uuid().optional(),
});

/** Ngân sách token cho ngữ cảnh khi sửa MỘT slide (chỉ cần đủ để căn cứ lại nguồn). */
const EDIT_CONTEXT_TOKENS = 12_000;

/**
 * Sửa một slide bằng AI: lấy nội dung phiên bản hiện tại, dựng lại `contextText` từ `content.evidence` đã lưu
 * (số `[n]` khớp với `slide.citations`), gọi engine, lưu kết quả thành phiên bản MỚI và trả nội dung.
 */
export async function aiEditSlide(
  access: ArtifactAccess,
  userId: string,
  slideId: string,
  input: z.infer<typeof slideAiEditSchema>,
  deps: { provider?: AiProvider } = {},
) {
  requireEdit(access);
  const artifact = access.artifact;
  if (artifact.type !== "slide_deck") throw ApiError.badRequest("Chỉ áp dụng cho bài thuyết trình", "unsupported_type");
  if (artifact.status === "queued" || artifact.status === "generating") {
    throw ApiError.conflict("Artifact đang được tạo, chưa thể sửa nội dung", "already_generating");
  }
  if (!artifact.currentVersionId) throw ApiError.conflict("Artifact chưa có nội dung", "not_ready");
  if (input.baseVersionId && input.baseVersionId !== artifact.currentVersionId) {
    throw ApiError.conflict("Nội dung đã được người khác cập nhật. Hãy tải lại để xem phiên bản mới nhất.", "version_conflict");
  }
  const engine = getSlideEngine();
  if (!engine.editSlide) throw ApiError.badRequest("Engine slide không hỗ trợ sửa bằng AI", "not_implemented");

  const [cur] = await db.select().from(artifactVersions).where(eq(artifactVersions.id, artifact.currentVersionId)).limit(1);
  const content = contentSchemaFor("slide_deck").parse(cur?.content) as SlideDeckContent;
  if (!content.slides.some((s) => s.id === slideId)) throw ApiError.notFound("Không tìm thấy slide");

  // Giữ nguyên thứ tự/đánh số bằng chứng của deck để `[n]` trong slide vẫn đúng.
  const evidence = content.evidence as unknown as Evidence[];
  const ctx = buildContext(evidence, { tokenBudget: EDIT_CONTEXT_TOKENS });

  const provider = deps.provider ?? (await getAiProviderForUser(userId));
  const models = await getUserModels(userId);
  const next = await engine.editSlide({
    content,
    slideId,
    instruction: input.instruction,
    contextText: ctx.contextText,
    provider,
    model: models.artifact,
  });
  const parsed = contentSchemaFor("slide_deck").parse(next);
  const version = await addVersion(artifact.id, {
    content: parsed,
    userId,
    note: t("studio.version.aiEditNote"),
    baseVersionId: artifact.currentVersionId,
  });
  return { content: parsed, version };
}
