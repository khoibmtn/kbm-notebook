/**
 * Siêu dữ liệu Studio dùng chung client + server: tuỳ chọn tạo, DTO API, định dạng xuất theo loại.
 */
import { z } from "zod";
import { modelNameSchema } from "@/lib/validators/model";
import { ARTIFACT_TYPE_LIST, type ArtifactTypeName } from "./content";

export type { ArtifactTypeName };

export type ArtifactStatus = "queued" | "generating" | "ready" | "failed";
export type ArtifactVisibility = "private" | "notebook" | "link" | "public";
export type ExportFormat = "pptx" | "docx" | "pdf" | "png" | "svg" | "csv" | "md" | "json" | "apkg_tsv";

export const ARTIFACT_VISIBILITIES: readonly ArtifactVisibility[] = ["private", "notebook", "link", "public"];

/* -------------------------------------------------------------------------- */
/* Tuỳ chọn tạo                                                                */
/* -------------------------------------------------------------------------- */

export const artifactOptionsSchema = z.object({
  language: z.string().trim().max(40).optional(),
  /** report / study_guide / note / faq */
  length: z.enum(["short", "medium", "long"]).optional(),
  /** report: kiểu tài liệu. */
  format: z.enum(["briefing", "study_guide", "faq", "timeline"]).optional(),
  /** quiz / flashcards / faq: số lượng. */
  count: z.number().int().min(1).max(100).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  questionTypes: z.array(z.enum(["mcq", "tf", "short"])).min(1).max(3).optional(),
  /** mindmap: số cấp. */
  depth: z.number().int().min(2).max(5).optional(),
  /** data_table: gợi ý các cột. */
  columnsHint: z.string().trim().max(500).optional(),
  /** slide_deck */
  slideCount: z.union([z.literal("auto"), z.number().int().min(3).max(60)]).optional(),
  style: z.enum(["detailed", "concise"]).optional(),
  audience: z.string().trim().max(200).optional(),
  includeImages: z.boolean().optional(),
  /** infographic */
  orientation: z.enum(["portrait", "landscape"]).optional(),
  detailLevel: z.enum(["low", "medium", "high"]).optional(),
});
export type ArtifactOptions = z.infer<typeof artifactOptionsSchema>;

export const artifactScopeSchema = z.object({
  /** Rỗng/thiếu → mọi nguồn `ready` mà người tạo được dùng. */
  sourceIds: z.array(z.string().uuid()).max(500).optional(),
});
export type ArtifactScope = z.infer<typeof artifactScopeSchema>;

const typeEnum = z.enum(ARTIFACT_TYPE_LIST);

export const createArtifactSchema = z.object({
  type: typeEnum,
  title: z.string().trim().min(1).max(200).optional(),
  customPrompt: z.string().trim().max(8000).optional(),
  options: artifactOptionsSchema.optional(),
  scope: artifactScopeSchema.optional(),
  model: modelNameSchema.optional(),
});
export type CreateArtifactInput = z.infer<typeof createArtifactSchema>;

export const regenerateArtifactSchema = z.object({
  customPrompt: z.string().trim().max(8000).optional(),
  options: artifactOptionsSchema.optional(),
  scope: artifactScopeSchema.optional(),
  model: modelNameSchema.optional(),
});
export type RegenerateArtifactInput = z.infer<typeof regenerateArtifactSchema>;

export const updateArtifactSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    /** Nội dung mới (kiểm theo loại ở server) → tạo phiên bản mới. */
    content: z.unknown().optional(),
    /** Ghi chú cho phiên bản. */
    note: z.string().trim().max(300).optional(),
    /** Id phiên bản mà client đang sửa; lệch với phiên bản hiện tại → 409. */
    baseVersionId: z.string().uuid().optional(),
  })
  .refine((v) => v.title !== undefined || v.content !== undefined, "Cần title hoặc content");
export type UpdateArtifactInput = z.infer<typeof updateArtifactSchema>;

export const shareVisibilitySchema = z.object({ visibility: z.enum(["private", "notebook", "link", "public"]) });

export const addArtifactShareSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    userId: z.string().uuid().optional(),
    role: z.enum(["view", "edit"]).default("view"),
  })
  .refine((v) => Boolean(v.email) !== Boolean(v.userId), "Cần đúng một trong email hoặc userId");

export const exportArtifactSchema = z.object({
  format: z.enum(["pptx", "docx", "pdf", "png", "svg", "csv", "md", "json", "apkg_tsv"]),
  versionId: z.string().uuid().optional(),
});

/* -------------------------------------------------------------------------- */
/* Định dạng xuất                                                              */
/* -------------------------------------------------------------------------- */

const DOC_FORMATS: ExportFormat[] = ["docx", "pdf", "md", "json"];

export const EXPORT_FORMATS_BY_TYPE: Record<ArtifactTypeName, ExportFormat[]> = {
  note: DOC_FORMATS,
  report: DOC_FORMATS,
  study_guide: DOC_FORMATS,
  faq: DOC_FORMATS,
  timeline: DOC_FORMATS,
  quiz: ["csv", "docx", "pdf", "md", "json"],
  flashcards: ["csv", "apkg_tsv", "docx", "pdf", "md", "json"],
  mindmap: ["png", "svg", "md", "json"],
  data_table: ["csv", "docx", "pdf", "md", "json"],
  slide_deck: ["pptx", "pdf", "json"],
  infographic: ["svg", "png", "pdf", "json"],
};

export const EXPORT_FORMAT_INFO: Record<ExportFormat, { ext: string; mime: string }> = {
  pptx: { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  docx: { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pdf: { ext: "pdf", mime: "application/pdf" },
  png: { ext: "png", mime: "image/png" },
  svg: { ext: "svg", mime: "image/svg+xml" },
  csv: { ext: "csv", mime: "text/csv; charset=utf-8" },
  md: { ext: "md", mime: "text/markdown; charset=utf-8" },
  json: { ext: "json", mime: "application/json" },
  apkg_tsv: { ext: "tsv", mime: "text/tab-separated-values; charset=utf-8" },
};

/** Định dạng cần Chromium → chạy bằng job `export_artifact` (còn lại xuất đồng bộ). */
export function isAsyncExport(type: ArtifactTypeName, format: ExportFormat): boolean {
  if (format === "pdf" || format === "png") return true;
  if (format === "svg" && type === "mindmap") return true;
  return false;
}

export function isExportFormatAllowed(type: ArtifactTypeName, format: ExportFormat): boolean {
  return EXPORT_FORMATS_BY_TYPE[type].includes(format);
}

/* -------------------------------------------------------------------------- */
/* DTO                                                                         */
/* -------------------------------------------------------------------------- */

export type ArtifactDto = {
  id: string;
  notebookId: string;
  type: ArtifactTypeName;
  title: string;
  status: ArtifactStatus;
  error: string | null;
  visibility: ArtifactVisibility;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  currentVersionId: string | null;
  currentVersionNo: number | null;
  forkedFromId: string | null;
  /** Nội dung được sinh từ nguồn riêng tư → chỉ ở chế độ riêng tư, không chuyển sang sổ tay/liên kết/công khai được. */
  containsPrivateSources: boolean;
  /** Người gọi được sửa nội dung. */
  canEdit: boolean;
  /** Người gọi được đổi chia sẻ/xoá. */
  canManage: boolean;
};

export type ArtifactDetailDto = ArtifactDto & {
  /** Nội dung phiên bản hiện tại (null nếu chưa tạo xong). */
  content: unknown | null;
  /** Chỉ có với người quản lý. */
  shareToken: string | null;
  generationConfig: {
    customPrompt?: string;
    options?: ArtifactOptions;
    scope?: ArtifactScope;
    model?: string;
  } | null;
};

export type ArtifactVersionDto = {
  id: string;
  artifactId: string;
  versionNo: number;
  note: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  isCurrent: boolean;
};

export type ArtifactExportDto = {
  id: string;
  artifactId: string;
  versionId: string;
  versionNo: number | null;
  format: ExportFormat;
  fileId: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  /** Đường dẫn tải (qua `/api/files/[id]`). */
  url: string;
};

export type ArtifactShareDto = {
  id: string;
  artifactId: string;
  userId: string | null;
  email: string | null;
  name: string | null;
  role: "view" | "edit";
  createdAt: string;
};

/** Sự kiện realtime `artifact:status`. */
export type ArtifactStatusEvent = {
  artifactId: string;
  notebookId: string;
  type: ArtifactTypeName;
  status: ArtifactStatus;
  /** 0–100 khi đang tạo. */
  progress: number;
  stage?: string;
  error: string | null;
  createdBy: string;
  visibility: ArtifactVisibility;
  /** status: chỉ đổi trạng thái/tiến độ; created/updated/deleted: cần tải lại danh sách. */
  change: "status" | "created" | "updated" | "deleted";
};

/** Sự kiện realtime `artifact:export` (gửi tới người yêu cầu xuất). */
export type ArtifactExportEvent = {
  artifactId: string;
  jobId: string;
  status: "done" | "failed";
  export?: ArtifactExportDto;
  error?: string;
};

/** Phản hồi của `GET /api/notebooks/[id]/artifacts`. */
export type ArtifactListResponse = {
  artifacts: ArtifactDto[];
  /** Loại nào đã có engine tạo (slide_deck/infographic phụ thuộc mô-đun engine riêng). */
  engines: Record<ArtifactTypeName, boolean>;
};

/** Tên tệp an toàn từ tiêu đề. */
export function safeFileName(title: string, fallback = "artifact"): string {
  const base = title
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return base || fallback;
}
