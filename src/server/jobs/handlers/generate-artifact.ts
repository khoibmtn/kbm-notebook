import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { ZodError } from "zod";
import { getAiProviderForUser, getUserModels } from "@/server/ai";
import { buildContext } from "@/server/ai/context";
import type { AiProvider } from "@/server/ai/provider";
import { composePrompt } from "@/server/artifacts/prompt";
import { collectEvidence, EVIDENCE_PROFILES, type CollectDeps } from "@/server/artifacts/evidence";
import { runGenerator } from "@/server/artifacts/generators";
import type { SlideDeckContent } from "@/server/artifacts/registry";
import { persistSlideImages } from "@/server/artifacts/slide-images";
import { addVersion, configOf, emitArtifactEvent, type GenerateArtifactPayload } from "@/server/artifacts/service";
import { contentSchemaFor, type ArtifactEvidence } from "@/lib/artifacts/content";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { artifacts, type Artifact } from "@/server/db/schema";
import { getPrompts } from "@/server/settings/service";
import { t } from "@/lib/i18n";
import { registerJobHandler, type JobHandler } from "../worker";

export type GenerateDeps = CollectDeps & {
  getProvider?: (userId: string) => Promise<AiProvider>;
};

export type GenerateOutcome =
  | { ok: true; artifactId: string; versionNo: number; strategy: "full" | "multi_query"; evidenceCount: number }
  | { ok: false; artifactId: string; error: string; skipped?: boolean };

/** Lỗi mà thử lại cũng vô ích (thiếu nguồn, chưa có engine, thiếu/hỏng khoá AI, tham số sai). */
export function classifyGenerateError(err: unknown): { message: string; permanent: boolean } {
  if (err instanceof ApiError) return { message: err.message, permanent: err.status < 500 && err.status !== 429 ? true : err.status === 501 };
  if (err instanceof ZodError) return { message: "Model trả về dữ liệu không hợp lệ", permanent: false };
  const e = err as { name?: string; message?: string; status?: number | null } | null;
  const message = e?.message ? String(e.message) : "Lỗi không xác định khi tạo artifact";
  if (e?.name === "AiNotConfiguredError") return { message, permanent: true };
  if (e?.name === "AiProviderError" && typeof e.status === "number" && e.status >= 400 && e.status < 500 && e.status !== 429) {
    return { message, permanent: true };
  }
  return { message, permanent: false };
}

async function setStatus(artifactId: string, status: Artifact["status"], error: string | null): Promise<Artifact | null> {
  const [row] = await db
    .update(artifacts)
    .set({ status, error, updatedAt: new Date() })
    .where(and(eq(artifacts.id, artifactId), isNull(artifacts.deletedAt)))
    .returning();
  return row ?? null;
}

/**
 * Tạo nội dung artifact (lõi của job `generate_artifact`):
 * phạm vi nguồn → bằng chứng (xem `evidence.ts`) → ngữ cảnh đánh số → prompt → generator → kiểm schema → phiên bản mới → `ready`.
 * Lỗi KHÔNG bao giờ được thay bằng nội dung giả: artifact chuyển `failed` kèm thông báo.
 */
export async function generateArtifactNow(
  payload: GenerateArtifactPayload,
  attempt: { attempts: number; maxAttempts: number },
  progress: (percent: number) => Promise<void> = async () => {},
  deps: GenerateDeps = {},
): Promise<GenerateOutcome> {
  const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, payload.artifactId)).limit(1);
  if (!artifact || artifact.deletedAt) return { ok: false, artifactId: payload.artifactId, error: "Artifact đã bị xoá", skipped: true };

  const report = async (percent: number, stage: string) => {
    await progress(percent);
    emitArtifactEvent(artifact, "status", { progress: percent, stage });
  };

  try {
    const generating = await setStatus(artifact.id, "generating", null);
    if (!generating) return { ok: false, artifactId: artifact.id, error: "Artifact đã bị xoá", skipped: true };
    artifact.status = "generating";
    artifact.error = null;
    await report(3, t("studio.stage.start"));

    const cfg = configOf(artifact);
    const userId = payload.userId;
    const provider = await (deps.getProvider ?? getAiProviderForUser)(userId);
    const models = await getUserModels(userId);
    const model = cfg.model || models.artifact;
    const overrides = await getPrompts(userId);
    const composed = composePrompt({
      type: artifact.type,
      override: overrides[artifact.type],
      customPrompt: cfg.customPrompt,
      options: cfg.options,
    });

    await report(5, t("studio.stage.retrieving"));
    const collected = await collectEvidence(
      {
        type: artifact.type,
        notebookId: artifact.notebookId,
        userId,
        sourceIds: cfg.scope?.sourceIds,
        instructions: cfg.customPrompt ?? "",
        onProgress: (done, total) => report(5 + Math.round((done / Math.max(total, 1)) * 40), t("studio.stage.retrieving")),
      },
      deps,
    );

    await report(50, t("studio.stage.context"));
    const budget = EVIDENCE_PROFILES[artifact.type].budget;
    const ctx = buildContext(collected.evidence, { tokenBudget: budget + 4000 });
    const evidence: ArtifactEvidence[] = ctx.evidence.map((e) => ({
      id: e.id,
      provider: e.provider,
      sourceId: e.sourceId,
      sourceTitle: e.sourceTitle,
      locator: e.locator,
      text: e.text,
      score: e.score,
      ...(e.similarity !== undefined ? { similarity: e.similarity } : {}),
    }));

    await report(55, t("studio.stage.generating"));
    const generated = await runGenerator(artifact.type, {
      contextText: ctx.contextText,
      evidence,
      instructions: composed.user,
      options: composed.options,
      provider,
      model,
      system: composed.system,
    });

    await report(90, t("studio.stage.saving"));
    // Ảnh AI do engine slide trả dạng dataUrl → lưu vào kho tệp, thay bằng fileId trước khi ghi phiên bản.
    const raw = artifact.type === "slide_deck" ? await persistSlideImages(generated.content as SlideDeckContent, userId, artifact.title) : generated.content;
    const content = contentSchemaFor(artifact.type).parse(raw);
    const note = payload.reason === "create" ? t("studio.version.generatedNote") : t("studio.version.regeneratedNote");
    const version = await addVersion(artifact.id, { content, userId, note, setStatusReady: true });
    if (cfg.titleAuto && generated.title) {
      await db.update(artifacts).set({ title: generated.title.slice(0, 200) }).where(eq(artifacts.id, artifact.id));
    }
    const [done] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id)).limit(1);
    emitArtifactEvent(done ?? { ...artifact, status: "ready", error: null }, "updated", { progress: 100 });
    await progress(100);
    return { ok: true, artifactId: artifact.id, versionNo: version.versionNo, strategy: collected.strategy, evidenceCount: evidence.length };
  } catch (err) {
    const { message, permanent } = classifyGenerateError(err);
    const lastAttempt = attempt.attempts >= attempt.maxAttempts;
    if (permanent || lastAttempt) {
      const failed = await setStatus(artifact.id, "failed", message);
      if (failed) emitArtifactEvent(failed, "updated");
      if (permanent) return { ok: false, artifactId: artifact.id, error: message };
      throw err;
    }
    // Lỗi tạm thời: giữ trạng thái đang tạo, worker sẽ thử lại theo backoff.
    emitArtifactEvent({ ...artifact, status: "generating" }, "status", { progress: 0, stage: t("studio.stage.retrying") });
    throw err;
  }
}

export function createGenerateArtifactHandler(deps: GenerateDeps = {}): JobHandler<GenerateArtifactPayload> {
  return ({ job, payload, progress }) => generateArtifactNow(payload, { attempts: job.attempts, maxAttempts: job.maxAttempts }, progress, deps);
}

/** Đăng ký handler `generate_artifact` — gọi từ `server.ts`. */
export function registerGenerateArtifactHandler(): void {
  registerJobHandler<GenerateArtifactPayload>("generate_artifact", createGenerateArtifactHandler());
}
