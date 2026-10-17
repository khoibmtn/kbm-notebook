/**
 * Kiểm chứng Gemini THẬT ngoài giao diện (docs/00 §6.1 bước 1 và 2; kịch bản đầy đủ ở docs/11-kiem-chung-gemini.md).
 *
 *   pnpm verify:gemini                      # khoá server GEMINI_API_KEY trong .env
 *   pnpm verify:gemini --user ten@email     # khoá người dùng đã lưu ở Cài đặt → AI (giải mã bằng APP_ENCRYPTION_KEY)
 *   pnpm verify:gemini --mock               # chỉ kiểm tra "đường ống" của script bằng MockAiProvider, không gọi Google
 *   pnpm verify:gemini --only models,embedding --skip image,web --chat-model gemini-2.5-flash
 *
 * Mỗi bước dùng ĐÚNG lớp mã của ứng dụng (GeminiProvider, buildContext, postCheckAnswer, composePrompt, runGenerator,
 * engine slide/infographic) nên kết quả phản ánh hành vi thật của app. Báo cáo JSON ghi ở outputs/ (gitignore).
 */
import "@/server/load-env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { INSUFFICIENT_SIMILARITY_THRESHOLD, postCheckAnswer } from "@/server/ai/citations";
import { buildContext } from "@/server/ai/context";
import { GeminiProvider } from "@/server/ai/gemini";
import { MockAiProvider } from "@/server/ai/mock";
import { composeChatSystem, defaultChatSystemPrompt } from "@/server/ai/prompts/defaults";
import { DEFAULT_MODELS, type AiProvider, type Usage } from "@/server/ai/provider";
import { runGenerator } from "@/server/artifacts/generators";
import { composePrompt } from "@/server/artifacts/prompt";
import { registerDefaultEngines } from "@/server/artifacts/registry";
import { chunkSegments } from "@/server/knowledge/ingest/chunk";
import { markdownToSegments } from "@/server/knowledge/ingest/extract";
import type { Evidence } from "@/server/knowledge/providers/types";
import type { ArtifactEvidence } from "@/lib/artifacts/content";

/* -------------------------------------------------------------------------- */
/* Tham số dòng lệnh                                                            */
/* -------------------------------------------------------------------------- */

const CHECK_IDS = ["models", "embedding", "chat", "stream", "quiz", "slides", "infographic", "image", "web"] as const;
type CheckId = (typeof CHECK_IDS)[number];

type Args = {
  user?: string;
  mock: boolean;
  only: Set<CheckId> | null;
  skip: Set<CheckId>;
  chatModel?: string;
  artifactModel?: string;
  out?: string;
  sample: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { mock: false, only: null, skip: new Set(), sample: "docs/samples/mau-kiem-chung-gay-me.md" };
  const list = (v: string) =>
    new Set(
      v
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is CheckId => (CHECK_IDS as readonly string[]).includes(s)),
    );
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? "";
    if (a === "--user") args.user = next();
    else if (a === "--mock") args.mock = true;
    else if (a === "--only") args.only = list(next());
    else if (a === "--skip") args.skip = list(next());
    else if (a === "--chat-model") args.chatModel = next();
    else if (a === "--artifact-model") args.artifactModel = next();
    else if (a === "--out") args.out = next();
    else if (a === "--sample") args.sample = next();
    else if (a === "--help" || a === "-h") {
      console.log("Tham số: --user <email> | --mock | --only a,b | --skip a,b | --chat-model m | --artifact-model m | --sample path | --out path");
      console.log(`Các bước: ${CHECK_IDS.join(", ")}`);
      process.exit(0);
    }
  }
  return args;
}

/* -------------------------------------------------------------------------- */
/* Báo cáo                                                                      */
/* -------------------------------------------------------------------------- */

type Status = "pass" | "warn" | "fail" | "skip";
type Check = { id: CheckId; status: Status; ms: number; summary: string; details?: unknown };

const ICON: Record<Status, string> = { pass: "✓", warn: "!", fail: "✗", skip: "–" };

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) {
    const extra = (err as { errors?: string[] }).errors;
    return extra?.length ? `${err.message.split("\n")[0]} | ${extra.slice(0, 5).join(" | ")}` : err.message;
  }
  return String(err);
}

class Report {
  readonly checks: Check[] = [];
  readonly usage: Required<Usage> = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  addUsage(u?: Usage) {
    if (!u) return;
    this.usage.inputTokens += u.inputTokens ?? 0;
    this.usage.outputTokens += u.outputTokens ?? 0;
    this.usage.totalTokens += u.totalTokens ?? 0;
  }

  async run(id: CheckId, enabled: boolean, fn: () => Promise<Omit<Check, "id" | "ms">>): Promise<void> {
    if (!enabled) {
      this.checks.push({ id, status: "skip", ms: 0, summary: "bỏ qua theo tham số" });
      console.log(`${ICON.skip} ${id}: bỏ qua`);
      return;
    }
    const t0 = performance.now();
    console.log(`… ${id}`);
    try {
      const r = await fn();
      const ms = performance.now() - t0;
      this.checks.push({ id, ms, ...r });
      console.log(`${ICON[r.status]} ${id} (${fmt(ms)}): ${r.summary}`);
    } catch (err) {
      const ms = performance.now() - t0;
      const summary = errMessage(err);
      this.checks.push({ id, status: "fail", ms, summary });
      console.log(`${ICON.fail} ${id} (${fmt(ms)}): ${summary}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Chọn provider                                                                */
/* -------------------------------------------------------------------------- */

type KeySource = "mock" | "server" | "user";

async function resolveProvider(args: Args): Promise<{ provider: AiProvider; source: KeySource; email?: string }> {
  if (args.mock) return { provider: new MockAiProvider(), source: "mock" };
  if (args.user) {
    // Khoá người dùng lưu mã hoá trong user_settings (Cài đặt → AI) — giống getAiProviderForUser.
    const { db } = await import("@/server/db");
    const { users, userSettings } = await import("@/server/db/schema");
    const { decrypt } = await import("@/server/crypto");
    const { eq } = await import("drizzle-orm");
    const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, args.user)).limit(1);
    if (!u) throw new Error(`Không tìm thấy người dùng ${args.user} trong DB (${process.env.DATABASE_URL ?? "DATABASE_URL trống"})`);
    const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, u.id)).limit(1);
    if (!s?.geminiApiKeyEnc) throw new Error(`Người dùng ${u.email} chưa lưu khoá Gemini ở Cài đặt → AI`);
    return {
      provider: new GeminiProvider({ apiKey: decrypt(s.geminiApiKeyEnc), chatModel: args.chatModel ?? s.defaultChatModel, embeddingModel: s.embeddingModel }),
      source: "user",
      email: u.email,
    };
  }
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error("Không có khoá: đặt GEMINI_API_KEY trong .env, hoặc dùng --user <email> với khoá đã lưu ở Cài đặt → AI, hoặc --mock");
  }
  return { provider: new GeminiProvider({ apiKey: key, chatModel: args.chatModel }), source: "server" };
}

/* -------------------------------------------------------------------------- */
/* Dữ liệu mẫu → chunk (đúng chunker của pipeline ingest)                        */
/* -------------------------------------------------------------------------- */

type SampleChunk = { idx: number; text: string; section?: string; tokenCount: number };

function loadSample(file: string): { title: string; chunks: SampleChunk[] } {
  const md = readFileSync(path.resolve(process.cwd(), file), "utf8");
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(file);
  const { chunks } = chunkSegments(markdownToSegments(md));
  return { title, chunks: chunks.map((c) => ({ idx: c.idx, text: c.text, section: c.section, tokenCount: c.tokenCount })) };
}

function toEvidence(title: string, c: SampleChunk, similarity?: number): Evidence {
  return {
    id: `sample:${c.idx}`,
    provider: "local",
    kind: "chunk",
    sourceId: "sample",
    sourceTitle: title,
    locator: { section: c.section },
    text: c.text,
    score: similarity ?? 0,
    ...(similarity !== undefined ? { similarity } : {}),
  };
}

function toArtifactEvidence(e: Evidence): ArtifactEvidence {
  return {
    id: e.id,
    provider: e.provider,
    sourceId: e.sourceId,
    sourceTitle: e.sourceTitle,
    locator: e.locator,
    text: e.text,
    score: e.score,
    ...(e.similarity !== undefined ? { similarity: e.similarity } : {}),
  };
}

/** Vector đã chuẩn hoá L2 (GeminiProvider.embed) → cosine = tích vô hướng. */
function cosine(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Khối tin nhắn người dùng đúng như chat/ask.ts dựng. */
function chatUserMessage(contextText: string, question: string): string {
  return `NGUỒN (chỉ được trích dẫn các số [n] dưới đây):\n${contextText}\n\nCÂU HỎI:\n${question}`;
}

/* -------------------------------------------------------------------------- */
/* Câu hỏi kiểm chứng (khớp nội dung docs/samples/mau-kiem-chung-gay-me.md)     */
/* -------------------------------------------------------------------------- */

const QUERIES = {
  /** Có trong tài liệu, trùng nhiều từ khoá. */
  direct: "Thang điểm Apfel gồm những yếu tố nào và nguy cơ buồn nôn nôn sau mổ khi có 3 yếu tố là bao nhiêu?",
  /** Có trong tài liệu nhưng diễn đạt khác (ít trùng từ). */
  paraphrase: "Trước khi gây mê, người bệnh được phép uống nước lọc muộn nhất là mấy tiếng?",
  /** Cùng chuyên ngành nhưng tài liệu KHÔNG trả lời được. */
  related: "Liều khởi mê của propofol ở người lớn là bao nhiêu mg/kg?",
  /** Hoàn toàn không liên quan. */
  unrelated: "Cách nấu phở bò truyền thống Hà Nội cần những gia vị gì?",
} as const;

/* -------------------------------------------------------------------------- */
/* Chạy                                                                         */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const enabled = (id: CheckId) => (args.only ? args.only.has(id) : true) && !args.skip.has(id);
  const { provider, source, email } = await resolveProvider(args);
  const chatModel = args.chatModel ?? DEFAULT_MODELS.chat;
  const artifactModel = args.artifactModel ?? DEFAULT_MODELS.artifact;
  const sample = loadSample(args.sample);
  const report = new Report();

  console.log(`KBM Notebook · kiểm chứng Gemini · provider=${provider.id} · khoá=${source}${email ? ` (${email})` : ""}`);
  console.log(`Model: chat=${chatModel} · artifact=${artifactModel} · embedding=${DEFAULT_MODELS.embedding} · image=${DEFAULT_MODELS.image}`);
  console.log(`Tài liệu mẫu: "${sample.title}" → ${sample.chunks.length} chunk (${sample.chunks.reduce((n, c) => n + c.tokenCount, 0)} token ước lượng)\n`);

  // ---------------------------------------------------------------- 1. Danh sách model (§6.1 bước 2)
  await report.run("models", enabled("models"), async () => {
    if (!provider.listModels) return { status: "skip", summary: "provider không có listModels" };
    const names = await provider.listModels();
    const wanted = { chat: chatModel, artifact: artifactModel, embedding: DEFAULT_MODELS.embedding, image: DEFAULT_MODELS.image };
    const missing = Object.entries(wanted).filter(([, m]) => !names.includes(m));
    const pick = (re: RegExp, exclude?: RegExp) => names.filter((n) => re.test(n) && !(exclude && exclude.test(n))).slice(-12);
    const candidates = {
      text: pick(/^gemini-.*(flash|pro)/, /(tts|image|live|audio|embedding|native|computer)/),
      embedding: pick(/embedding/),
      image: pick(/image/),
    };
    const details = { total: names.length, wanted, missing: missing.map(([k, m]) => `${k}=${m}`), candidates };
    if (missing.length === 0) return { status: "pass", summary: `${names.length} model; đủ 4 model mặc định`, details };
    return {
      status: "warn",
      summary: `${names.length} model; KHÔNG thấy trong danh sách: ${details.missing.join(", ")} (alias vẫn có thể gọi được — xem các bước sau)`,
      details,
    };
  });

  // ---------------------------------------------------------------- 2. Embedding + ngưỡng similarity
  let chunkVectors: number[][] = [];
  let queryVectors: Record<keyof typeof QUERIES, number[]> | null = null;
  const rankChunks = (qv: number[]) =>
    sample.chunks
      .map((c, i) => ({ chunk: c, similarity: cosine(qv, chunkVectors[i]) }))
      .sort((a, b) => b.similarity - a.similarity);

  await report.run("embedding", enabled("embedding"), async () => {
    chunkVectors = await provider.embed(
      sample.chunks.map((c) => c.text),
      { taskType: "RETRIEVAL_DOCUMENT" },
    );
    const keys = Object.keys(QUERIES) as Array<keyof typeof QUERIES>;
    const qv = await provider.embed(
      keys.map((k) => QUERIES[k]),
      { taskType: "RETRIEVAL_QUERY" },
    );
    queryVectors = Object.fromEntries(keys.map((k, i) => [k, qv[i]])) as Record<keyof typeof QUERIES, number[]>;
    const dim = chunkVectors[0]?.length ?? 0;
    const rows = keys.map((k) => {
      const top = rankChunks(queryVectors![k])[0];
      return { query: k, maxSimilarity: Number(top.similarity.toFixed(3)), topSection: top.chunk.section ?? `chunk ${top.chunk.idx}` };
    });
    const sim = Object.fromEntries(rows.map((r) => [r.query, r.maxSimilarity])) as Record<keyof typeof QUERIES, number>;
    const thr = INSUFFICIENT_SIMILARITY_THRESHOLD;
    const problems: string[] = [];
    if (sim.direct < thr) problems.push(`câu hỏi trực tiếp chỉ đạt ${sim.direct} < ngưỡng ${thr} → sẽ bị gắn cờ thiếu bằng chứng oan`);
    if (sim.paraphrase < thr) problems.push(`câu hỏi diễn giải chỉ đạt ${sim.paraphrase} < ngưỡng ${thr}`);
    if (sim.unrelated >= thr) problems.push(`câu hỏi KHÔNG liên quan vẫn đạt ${sim.unrelated} ≥ ngưỡng ${thr} → ngưỡng quá thấp, không chặn được`);
    const lowRelevant = Math.min(sim.direct, sim.paraphrase);
    const suggested = sim.unrelated < lowRelevant ? Number(((sim.unrelated + lowRelevant) / 2).toFixed(2)) : null;
    const details = { dim, threshold: thr, rows, suggestedThreshold: suggested, note: "similarity của câu 'related' chỉ để tham khảo (cùng chuyên ngành, tài liệu không trả lời được)" };
    for (const r of rows) console.log(`    ${r.query.padEnd(10)} max cos = ${r.maxSimilarity.toFixed(3)}  (${r.topSection})`);
    if (dim !== 768) problems.push(`chiều vector = ${dim}, app cần 768`);
    if (problems.length) return { status: "warn", summary: `${problems.join("; ")}${suggested ? ` — gợi ý ngưỡng ≈ ${suggested}` : ""}`, details };
    return {
      status: "pass",
      summary: `768 chiều; liên quan ≥ ${lowRelevant} > ngưỡng ${thr} > không liên quan ${sim.unrelated}${suggested ? ` (điểm giữa ≈ ${suggested})` : ""}`,
      details,
    };
  });

  const evidenceFor = (key: keyof typeof QUERIES, topK = 4): Evidence[] => {
    if (!queryVectors || chunkVectors.length === 0) return sample.chunks.slice(0, topK).map((c) => toEvidence(sample.title, c));
    return rankChunks(queryVectors[key])
      .slice(0, topK)
      .map(({ chunk, similarity }) => toEvidence(sample.title, chunk, similarity));
  };
  const system = composeChatSystem(defaultChatSystemPrompt, null);

  // ---------------------------------------------------------------- 3. Chat có trích dẫn + từ chối khi thiếu bằng chứng
  await report.run("chat", enabled("chat"), async () => {
    const ask = async (key: keyof typeof QUERIES) => {
      const ctx = buildContext(evidenceFor(key));
      const res = await provider.generateText({
        model: chatModel,
        system,
        messages: [{ role: "user", content: chatUserMessage(ctx.contextText, QUERIES[key]) }],
        temperature: 0.3,
      });
      report.addUsage(res.usage);
      const checked = postCheckAnswer(res.text, ctx.evidence);
      return { key, question: QUERIES[key], answer: checked.content, raw: res.text, usedNumbers: checked.usedNumbers, removedNumbers: checked.removedNumbers, insufficientReason: checked.insufficientReason, usage: res.usage };
    };
    const good = await ask("direct");
    const bad = await ask("related");
    const problems: string[] = [];
    if (good.usedNumbers.length === 0) problems.push("câu trả lời được KHÔNG có trích dẫn [n] nào");
    if (good.removedNumbers.length) problems.push(`mô hình bịa số trích dẫn ${good.removedNumbers.join(",")} (đã bị hậu kiểm loại)`);
    if (good.insufficientReason) problems.push(`câu trả lời được vẫn bị gắn cờ: ${good.insufficientReason}`);
    if (!bad.insufficientReason) problems.push("câu hỏi KHÔNG có trong nguồn lại được trả lời như có bằng chứng (nguy cơ bịa)");
    console.log(`    [direct]  dùng [${good.usedNumbers.join(",")}] · loại [${good.removedNumbers.join(",") || "-"}] · cờ=${good.insufficientReason ?? "không"}`);
    console.log(`    [related] dùng [${bad.usedNumbers.join(",") || "-"}] · cờ=${bad.insufficientReason ?? "không"}`);
    console.log(`    Trả lời (direct): ${good.answer.replace(/\s+/g, " ").slice(0, 220)}…`);
    const details = { good, bad, model: chatModel };
    if (problems.length) return { status: provider.id === "mock" ? "warn" : "fail", summary: problems.join("; "), details };
    return { status: "pass", summary: `trích dẫn hợp lệ [${good.usedNumbers.join(",")}], không bịa số; câu ngoài nguồn → ${bad.insufficientReason}`, details };
  });

  // ---------------------------------------------------------------- 4. Streaming SSE
  await report.run("stream", enabled("stream"), async () => {
    const ctx = buildContext(evidenceFor("paraphrase"));
    const t0 = performance.now();
    let first = 0;
    let chunks = 0;
    let text = "";
    let usage: Usage | undefined;
    for await (const ev of provider.streamText({ model: chatModel, system, messages: [{ role: "user", content: chatUserMessage(ctx.contextText, QUERIES.paraphrase) }] })) {
      if (ev.delta) {
        if (!first) first = performance.now() - t0;
        chunks++;
        text += ev.delta;
      }
      if (ev.done) usage = ev.usage;
    }
    report.addUsage(usage);
    const checked = postCheckAnswer(text, ctx.evidence);
    const details = { firstTokenMs: Math.round(first), chunks, answer: checked.content, usedNumbers: checked.usedNumbers, insufficientReason: checked.insufficientReason };
    if (!text.trim()) return { status: "fail", summary: "không nhận được delta nào", details };
    const status = checked.usedNumbers.length ? "pass" : "warn";
    return { status, summary: `${chunks} chunk, token đầu sau ${fmt(first)}, trích dẫn [${checked.usedNumbers.join(",") || "-"}]`, details };
  });

  // ---------------------------------------------------------------- 5–7. Studio: quiz, slide deck, infographic (toàn bộ tài liệu)
  const allEvidence = buildContext(sample.chunks.map((c) => toEvidence(sample.title, c)), { tokenBudget: 60_000 });
  const studioEvidence = allEvidence.evidence.map(toArtifactEvidence);
  registerDefaultEngines();

  const runStudio = (type: "quiz" | "slide_deck" | "infographic", options: Record<string, unknown>) => {
    const composed = composePrompt({ type, options });
    return runGenerator(type, {
      contextText: allEvidence.contextText,
      evidence: studioEvidence,
      instructions: composed.user,
      options: composed.options,
      provider,
      model: artifactModel,
      system: composed.system,
    });
  };

  await report.run("quiz", enabled("quiz"), async () => {
    const out = await runStudio("quiz", { count: 5, questionTypes: ["mcq", "tf"], difficulty: "medium" });
    const content = out.content as { questions: Array<{ type: string; stem: string; citations?: number[] }>; evidence: unknown[] };
    const n = content.questions.length;
    const cited = content.questions.filter((q) => (q.citations?.length ?? 0) > 0).length;
    const details = { title: out.title, questions: n, withCitations: cited, evidence: content.evidence.length, sample: content.questions.slice(0, 2) };
    console.log(`    ${n} câu hỏi (${cited} có trích dẫn) · tiêu đề: ${out.title ?? "-"}`);
    if (n === 0) return { status: "fail", summary: "không có câu hỏi hợp lệ", details };
    return { status: cited === n ? "pass" : "warn", summary: `${n}/5 câu, ${cited} câu có trích dẫn, ${content.evidence.length} bằng chứng được dùng`, details };
  });

  await report.run("slides", enabled("slides"), async () => {
    const out = await runStudio("slide_deck", { slideCount: 8, style: "concise", includeImages: false, audience: "bác sĩ nội trú gây mê" });
    const content = out.content as { slides: Array<{ layout: string; title: string; notes?: string; citations?: number[]; chart?: unknown; table?: unknown }>; evidence: unknown[] };
    const slides = content.slides;
    const layouts = [...new Set(slides.map((s) => s.layout))];
    const withNotes = slides.filter((s) => s.notes?.trim()).length;
    const withCites = slides.filter((s) => (s.citations?.length ?? 0) > 0).length;
    const dataSlides = slides.filter((s) => s.chart || s.table).length;
    const details = { slides: slides.length, layouts, withNotes, withCitations: withCites, dataSlides, titles: slides.map((s) => `${s.layout}: ${s.title}`) };
    for (const t of details.titles) console.log(`    · ${t}`);
    const problems: string[] = [];
    if (slides.length !== 8) problems.push(`yêu cầu 8 slide, nhận ${slides.length}`);
    if (withNotes < slides.length) problems.push(`${slides.length - withNotes} slide thiếu ghi chú diễn giả`);
    if (dataSlides === 0) problems.push("tài liệu có số liệu nhưng không có slide chart/table");
    return { status: problems.length ? "warn" : "pass", summary: problems.length ? problems.join("; ") : `${slides.length} slide, ${layouts.length} layout, ${withCites} slide có trích dẫn, ${dataSlides} slide số liệu`, details };
  });

  await report.run("infographic", enabled("infographic"), async () => {
    const out = await runStudio("infographic", { orientation: "portrait" });
    const content = out.content as { title: string; blocks: Array<{ type: string; citations?: number[] }>; evidence: unknown[] };
    const types = content.blocks.map((b) => b.type);
    const details = { title: content.title, blocks: types.length, types, withCitations: content.blocks.filter((b) => (b.citations?.length ?? 0) > 0).length };
    console.log(`    ${types.length} khối: ${types.join(", ")}`);
    if (types.length === 0) return { status: "fail", summary: "không có khối nào", details };
    const hasData = types.some((t) => t === "stat" || t === "chart");
    return { status: hasData ? "pass" : "warn", summary: `${types.length} khối (${[...new Set(types)].join(", ")}); số liệu đã qua kiểm chứng có trong nguồn`, details };
  });

  // ---------------------------------------------------------------- 8. Sinh ảnh
  const outDir = path.resolve(process.cwd(), "outputs");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");

  await report.run("image", enabled("image"), async () => {
    if (!provider.generateImage) return { status: "skip", summary: `provider ${provider.id} không có generateImage` };
    const img = await provider.generateImage("Minh hoạ phẳng, tối giản: bác sĩ gây mê đang khám đường thở cho người bệnh trước mổ, phong cách infographic y khoa, không chữ", { aspect: "16:9" });
    const ext = img.mime.includes("jpeg") ? "jpg" : img.mime.includes("webp") ? "webp" : "png";
    const file = path.join(outDir, `verify-gemini-${stamp}.${ext}`);
    writeFileSync(file, img.bytes);
    return { status: img.bytes.length > 10_000 ? "pass" : "warn", summary: `${img.mime}, ${(img.bytes.length / 1024).toFixed(0)} KB → ${path.relative(process.cwd(), file)}`, details: { file, mime: img.mime, bytes: img.bytes.length, model: DEFAULT_MODELS.image } };
  });

  // ---------------------------------------------------------------- 9. Web grounding (Google Search)
  await report.run("web", enabled("web"), async () => {
    const res = await provider.generateText({
      model: chatModel,
      system: "Bạn là công cụ tra cứu web. Dùng Google Search, tóm tắt ngắn gọn và trung thực, nêu rõ trang nào nói gì.",
      messages: [{ role: "user", content: "Khuyến cáo mới nhất về dự phòng buồn nôn nôn sau mổ (PONV) của các hội gây mê quốc tế là gì?" }],
      tools: { googleSearch: true },
    });
    report.addUsage(res.usage);
    const n = res.webSources?.length ?? 0;
    const details = { sources: res.webSources ?? [], summary: res.text.slice(0, 600) };
    for (const s of (res.webSources ?? []).slice(0, 5)) console.log(`    · ${s.title} — ${s.url}`);
    if (provider.id === "mock") return { status: "skip", summary: "mock không có grounding", details };
    return { status: n > 0 ? "pass" : "fail", summary: n > 0 ? `${n} nguồn web được trả về` : "không có groundingChunks nào (khoá/model không hỗ trợ Google Search?)", details };
  });

  // ---------------------------------------------------------------- Tổng kết
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of report.checks) counts[c.status]++;
  const file = path.resolve(process.cwd(), args.out ?? path.join("outputs", `verify-gemini-${stamp}.json`));
  mkdirSync(path.dirname(file), { recursive: true });
  const json = {
    ranAt: new Date().toISOString(),
    provider: provider.id,
    keySource: source,
    models: { chat: chatModel, artifact: artifactModel, embedding: DEFAULT_MODELS.embedding, image: DEFAULT_MODELS.image },
    threshold: INSUFFICIENT_SIMILARITY_THRESHOLD,
    sample: { file: args.sample, title: sample.title, chunks: sample.chunks.length },
    usage: report.usage,
    counts,
    checks: report.checks,
  };
  writeFileSync(file, JSON.stringify(json, null, 2));
  console.log(`\nKết quả: ${counts.pass} pass · ${counts.warn} cảnh báo · ${counts.fail} lỗi · ${counts.skip} bỏ qua · token đã dùng (chat/web): ${report.usage.totalTokens}`);
  console.log(`Báo cáo: ${path.relative(process.cwd(), file)}`);
  process.exitCode = counts.fail > 0 ? 1 : 0;
}

main()
  .catch((err: unknown) => {
    console.error(`✗ ${errMessage(err)}`);
    process.exitCode = 2;
  })
  .finally(() => {
    // Pool DB (khi dùng --user) giữ tiến trình sống; đóng để script kết thúc.
    const g = globalThis as { __kbmPool?: { end(): Promise<void> } };
    void g.__kbmPool?.end().catch(() => undefined);
  });
