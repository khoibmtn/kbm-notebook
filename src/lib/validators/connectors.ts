import { z } from "zod";
import { MAX_PUSH_TEXT_CHARS } from "@/lib/connectors";

export const connectorProviderSchema = z.enum(["notebooklm-bridge", "notebooklm-enterprise"]);

const urlField = z.string().trim().min(1, "URL không được để trống").max(2048);
const tokenField = z.string().trim().min(8, "Token quá ngắn").max(4096);

/** `PUT /api/connectors/bridge` — token bỏ trống = giữ token đã lưu. */
export const saveBridgeSchema = z.object({
  url: urlField,
  token: tokenField.optional(),
  allowPrivateHosts: z.boolean().default(false),
});

/** `POST /api/connectors/bridge/test` — mọi trường tuỳ chọn: thiếu thì dùng giá trị đã lưu. */
export const testBridgeSchema = z.object({
  url: urlField.optional(),
  token: tokenField.optional(),
  allowPrivateHosts: z.boolean().optional(),
});

const enterpriseAuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("access_token"), accessToken: z.string().trim().min(10, "Access token quá ngắn").max(8192) }),
  z.object({ type: z.literal("service_account"), serviceAccountJson: z.string().trim().min(20).max(20_000) }),
]);

const projectNumberField = z.string().trim().regex(/^\d{4,20}$/, "Số dự án phải là dãy số (project NUMBER)");
const locationField = z.enum(["global", "us", "eu"]);

export const saveEnterpriseSchema = z.object({
  projectNumber: projectNumberField,
  location: locationField,
  /** Bỏ trống = giữ xác thực đã lưu. */
  auth: enterpriseAuthSchema.optional(),
});

export const testEnterpriseSchema = z.object({
  projectNumber: projectNumberField.optional(),
  location: locationField.optional(),
  auth: enterpriseAuthSchema.optional(),
});

/** `POST /api/notebooks/[id]/connections` */
export const createConnectionSchema = z.object({
  provider: connectorProviderSchema,
  externalId: z.string().trim().min(1, "Thiếu ID notebook").max(256),
  label: z.string().trim().max(120).optional(),
  sharedWithMembers: z.boolean().default(false),
});

/** `PATCH /api/notebooks/[id]/connections/[connId]` */
export const updateConnectionSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    sharedWithMembers: z.boolean(),
    refreshCredentials: z.literal(true),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Không có thay đổi nào");

/** `POST …/connections/[connId]/notes` */
export const pushNoteSchema = z.object({
  title: z.string().trim().min(1, "Tiêu đề không được để trống").max(500),
  content: z.string().trim().min(1, "Nội dung không được để trống").max(MAX_PUSH_TEXT_CHARS * 2),
});

/** `POST …/connections/[connId]/sources` */
export const pushSourceSchema = z.object({ sourceId: z.string().uuid() });

/** `POST …/connections/[connId]/import` */
export const importFromConnectionSchema = z.object({
  externalSourceIds: z.array(z.string().trim().min(1).max(256)).min(1, "Chọn ít nhất một nguồn").max(50),
  visibility: z.enum(["shared", "private"]).default("shared"),
});

/** `POST /api/notebooks/[id]/drive/import` */
export const importDriveSchema = z.object({
  fileIds: z.array(z.string().trim().min(5).max(128)).min(1, "Chọn ít nhất một tệp").max(20),
  visibility: z.enum(["shared", "private"]).default("shared"),
});

export const driveListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  pageToken: z.string().trim().max(2048).optional(),
});
