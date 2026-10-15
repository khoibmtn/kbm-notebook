import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { SourceFileType } from "@/lib/sources";
import { env } from "@/server/env";
import { IngestError } from "./errors";
import type { Extracted, ExtractJob } from "./extract";
import { safeFetch } from "./ssrf";

/**
 * Trích xuất văn bản chạy trong `worker_threads` có timeout cứng + giới hạn bộ nhớ.
 * Tệp do người dùng tải lên có thể được chế tạo để treo bộ phân tích (XLSX khai báo vùng khổng lồ, XML lồng nhau…);
 * nếu chạy trong tiến trình chính, event loop của cả HTTP + Socket.IO + worker job sẽ đứng theo.
 * Ở đây worker bị `terminate()` khi quá hạn và nguồn chuyển sang `failed` với thông báo rõ ràng.
 */

export type ExtractWorkerReply =
  | { ok: true; result: Extracted & { finalUrl?: string } }
  | { ok: false; message: string; permanent: boolean };

export type SandboxOptions = {
  /** Mặc định: `INGEST_EXTRACT_TIMEOUT_SEC` (120 giây). */
  timeoutMs?: number;
  /** Mặc định: `INGEST_EXTRACT_MAX_MB` (1024 MB). */
  maxMemoryMb?: number;
  /** Đường dẫn tệp JS của worker (test dùng worker giả); mặc định là bản build của `extract-worker.ts`. */
  workerPath?: string;
};

export const EXTRACT_MESSAGES = {
  timeout: (sec: number) =>
    `Quá thời gian xử lý tài liệu (${sec} giây) — tệp quá lớn hoặc quá phức tạp nên đã bị dừng. Hãy thử tệp nhỏ hơn hoặc xuất lại tệp.`,
  memory: "Tài liệu quá lớn hoặc quá phức tạp, vượt giới hạn bộ nhớ khi xử lý.",
  crashed: "Tiến trình trích xuất tài liệu bị dừng đột ngột. Tệp có thể hỏng hoặc không hợp lệ.",
} as const;

/* -------------------------------------------------------------------------- */
/* Tìm / build tệp JS của worker                                               */
/* -------------------------------------------------------------------------- */

const WORKER_ENTRY = path.join("src", "server", "knowledge", "ingest", "extract-worker.ts");
let devBuild: Promise<string> | null = null;

/** Dev/test: đóng gói `extract-worker.ts` bằng esbuild (một lần mỗi tiến trình) vào node_modules/.cache. */
function buildDevWorker(): Promise<string> {
  devBuild ??= (async () => {
    const root = process.cwd();
    const outDir = path.join(root, "node_modules", ".cache", "kbm-extract-worker");
    fs.mkdirSync(outDir, { recursive: true });
    const outfile = path.join(outDir, `extract-worker.${process.pid}.cjs`);
    const esbuild = await import("esbuild");
    await esbuild.build({
      entryPoints: [path.join(root, WORKER_ENTRY)],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      packages: "external",
      tsconfig: path.join(root, "tsconfig.server.json"),
      outfile,
      logLevel: "silent",
    });
    process.once("exit", () => {
      try {
        fs.unlinkSync(outfile);
      } catch {
        /* đã xoá */
      }
    });
    return outfile;
  })();
  return devBuild;
}

async function resolveWorkerPath(): Promise<string> {
  const override = process.env.EXTRACT_WORKER_PATH;
  if (override) return override;
  if (process.env.NODE_ENV === "production") {
    // `pnpm build:server` tạo dist/extract-worker.js cạnh dist/server.js
    const candidates = [
      typeof __dirname === "string" ? path.join(__dirname, "extract-worker.js") : "",
      path.join(process.cwd(), "dist", "extract-worker.js"),
    ].filter(Boolean);
    const found = candidates.find((c) => fs.existsSync(c));
    if (!found) throw new IngestError("Thiếu tệp dist/extract-worker.js — hãy chạy `pnpm build`", { permanent: false });
    return found;
  }
  return buildDevWorker();
}

/* -------------------------------------------------------------------------- */
/* Chạy một worker                                                             */
/* -------------------------------------------------------------------------- */

function runWorker(workerPath: string, job: unknown, timeoutMs: number, maxMemoryMb: number): Promise<Extracted & { finalUrl?: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerPath, {
      workerData: job,
      resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 },
    });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new IngestError(EXTRACT_MESSAGES.timeout(Math.max(1, Math.round(timeoutMs / 1000))))));
    }, timeoutMs);
    timer.unref?.();
    worker.once("message", (reply: ExtractWorkerReply) => {
      finish(() => {
        if (reply.ok) resolve(reply.result);
        else reject(new IngestError(reply.message, { permanent: reply.permanent }));
      });
    });
    worker.once("error", (err: Error & { code?: string }) => {
      finish(() => {
        if (err.code === "ERR_WORKER_OUT_OF_MEMORY") reject(new IngestError(EXTRACT_MESSAGES.memory, { cause: err }));
        else reject(new IngestError(EXTRACT_MESSAGES.crashed, { cause: err }));
      });
    });
    worker.once("exit", () => {
      finish(() => reject(new IngestError(EXTRACT_MESSAGES.crashed)));
    });
  });
}

/** Sao chép dữ liệu cho worker (không chuyển quyền sở hữu buffer của người gọi). */
function copyBytes(buf: Buffer): Uint8Array {
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

async function run(job: ExtractJob, opts: SandboxOptions): Promise<Extracted & { finalUrl?: string }> {
  const timeoutMs = opts.timeoutMs ?? env().INGEST_EXTRACT_TIMEOUT_SEC * 1000;
  const maxMemoryMb = opts.maxMemoryMb ?? env().INGEST_EXTRACT_MAX_MB;
  const workerPath = opts.workerPath ?? (await resolveWorkerPath());
  return runWorker(workerPath, job, timeoutMs, maxMemoryMb);
}

/** Như `extractFile` nhưng chạy trong worker có timeout/giới hạn bộ nhớ. */
export function extractFileSandboxed(buf: Buffer, type: SourceFileType, opts: SandboxOptions = {}): Promise<Extracted> {
  return run({ op: "file", type, data: copyBytes(buf) }, opts);
}

/** Như `extractUrl`: tải về ở tiến trình chính (có chặn SSRF) rồi phân tích trong worker. */
export async function extractUrlSandboxed(url: string, opts: SandboxOptions = {}): Promise<Extracted & { finalUrl: string }> {
  const page = await safeFetch(url);
  const res = await run({ op: "page", contentType: page.contentType, finalUrl: page.finalUrl, data: copyBytes(page.body) }, opts);
  return { ...res, finalUrl: res.finalUrl ?? page.finalUrl };
}
