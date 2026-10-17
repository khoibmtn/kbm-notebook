import { describe, expect, it, vi } from "vitest";
import { MockAiProvider } from "@/server/ai/mock";
import {
  AiNotConfiguredError,
  AiProviderError,
  type AiProvider,
  type EmbedOptions,
  type TextRequest,
  type TextResult,
} from "@/server/ai/provider";
import { embedTexts, EMBED_BATCH_SIZE } from "@/server/knowledge/ingest/embed";
import { extractiveSummary, sampleForSummary, summarizeSource } from "@/server/knowledge/ingest/summarize";
import { classifyIngestError } from "@/server/jobs/handlers/ingest";
import { IngestError } from "@/server/knowledge/ingest/errors";

function fakeProvider(over: Partial<AiProvider>): AiProvider {
  return {
    id: "mock",
    generateText: async () => ({ text: "" }),
    streamText: async function* () {},
    embed: async (texts) => texts.map(() => [0]),
    ...over,
  };
}

describe("embedTexts", () => {
  it("chia batch 32, truyền taskType RETRIEVAL_DOCUMENT + dim 768, giữ đúng thứ tự", async () => {
    const calls: { n: number; opts?: EmbedOptions }[] = [];
    const provider = fakeProvider({
      embed: async (texts, opts) => {
        calls.push({ n: texts.length, opts });
        return texts.map((t) => [Number(t)]);
      },
    });
    const texts = Array.from({ length: 70 }, (_, i) => String(i));
    const progress: number[] = [];
    const out = await embedTexts(provider, texts, { onProgress: (done) => void progress.push(done) });
    expect(EMBED_BATCH_SIZE).toBe(32);
    expect(calls.map((c) => c.n)).toEqual([32, 32, 6]);
    expect(calls.every((c) => c.opts?.taskType === "RETRIEVAL_DOCUMENT" && c.opts.dim === 768)).toBe(true);
    expect(out.map((v) => v[0])).toEqual(texts.map(Number));
    expect(progress).toEqual([32, 64, 70]);
  });

  it("thử lại lỗi tạm thời (tối đa 3 lần) rồi thành công", async () => {
    const embed = vi.fn<AiProvider["embed"]>().mockRejectedValueOnce(new AiProviderError("quá tải", 503)).mockRejectedValueOnce(new Error("mạng")).mockResolvedValue([[1]]);
    const out = await embedTexts(fakeProvider({ embed }), ["a"], { retryDelayMs: 0 });
    expect(out).toEqual([[1]]);
    expect(embed).toHaveBeenCalledTimes(3);
  });

  it("hết lượt thử → ném lỗi gốc; lỗi cấu hình/khoá sai không thử lại", async () => {
    const always = vi.fn<AiProvider["embed"]>().mockRejectedValue(new Error("hỏng"));
    await expect(embedTexts(fakeProvider({ embed: always }), ["a"], { retryDelayMs: 0 })).rejects.toThrow("hỏng");
    expect(always).toHaveBeenCalledTimes(3);

    const notConfigured = vi.fn<AiProvider["embed"]>().mockRejectedValue(new AiNotConfiguredError());
    await expect(embedTexts(fakeProvider({ embed: notConfigured }), ["a"], { retryDelayMs: 0 })).rejects.toBeInstanceOf(AiNotConfiguredError);
    expect(notConfigured).toHaveBeenCalledTimes(1);

    const badKey = vi.fn<AiProvider["embed"]>().mockRejectedValue(new AiProviderError("key sai", 403));
    await expect(embedTexts(fakeProvider({ embed: badKey }), ["a"], { retryDelayMs: 0 })).rejects.toThrow("key sai");
    expect(badKey).toHaveBeenCalledTimes(1);
  });

  it("số vector trả về không khớp → coi là lỗi", async () => {
    const provider = fakeProvider({ embed: async () => [[1]] });
    await expect(embedTexts(provider, ["a", "b"], { retryDelayMs: 0 })).rejects.toThrow(/1\/2/);
  });
});

describe("summarizeSource", () => {
  const text = "Núi lửa phun trào khi magma dâng lên. Tro bụi che phủ bầu trời. Nhiều làng mạc bị chôn vùi. Người dân sơ tán kịp thời. Sau đó đất đai trở nên màu mỡ.";

  it("dùng kết quả JSON hợp lệ từ AI (có jsonSchema, tiếng Việt)", async () => {
    let seen: TextRequest | undefined;
    const provider = fakeProvider({
      generateText: async (req): Promise<TextResult> => {
        seen = req;
        return { text: "", json: { summary: "  Tóm tắt do AI.  ", key_topics: ["núi lửa", "núi lửa", "tro bụi", "sơ tán", "magma", "đất đai", "a", "b", "c", "d"] } };
      },
    });
    const res = await summarizeSource(provider, "Tiêu đề", text);
    expect(res.by).toBe("ai");
    expect(res.summary).toBe("Tóm tắt do AI.");
    expect(res.keyTopics).toHaveLength(8);
    expect(new Set(res.keyTopics).size).toBe(res.keyTopics.length);
    expect(seen?.jsonSchema).toBeDefined();
    expect(seen?.messages[seen.messages.length - 1].content).toContain(text);
  });

  it("AI lỗi / trả sai định dạng / mock → tóm tắt trích xuất từ chính văn bản", async () => {
    const thrown = await summarizeSource(fakeProvider({ generateText: async () => { throw new Error("quota"); } }), "T", text);
    expect(thrown.by).toBe("extractive");
    expect(thrown.summary).toContain("Núi lửa phun trào");
    const invalid = await summarizeSource(fakeProvider({ generateText: async () => ({ text: "không phải json" }) }), "T", text);
    expect(invalid.by).toBe("extractive");
    const mock = await summarizeSource(new MockAiProvider(), "T", text);
    expect(mock.by).toBe("extractive");
    expect(mock.summary.length).toBeGreaterThan(20);
  });

  it("extractiveSummary giới hạn độ dài + từ khoá tần suất cao, bỏ từ dừng", () => {
    const long = "Magma magma magma dâng lên. ".repeat(100) + "Và của là có.";
    const r = extractiveSummary(long);
    expect(r.summary.length).toBeLessThanOrEqual(700);
    expect(r.keyTopics[0]).toBe("magma");
    expect(r.keyTopics).not.toContain("của");
  });

  it("sampleForSummary lấy đầu + giữa + cuối khi văn bản quá dài", () => {
    const s = sampleForSummary("a".repeat(100) + "b".repeat(100) + "c".repeat(100), 90);
    expect(s.length).toBeLessThan(150);
    expect(s).toContain("a");
    expect(s).toContain("b");
    expect(s).toContain("c");
    expect(sampleForSummary("ngắn", 90)).toBe("ngắn");
  });
});

describe("classifyIngestError", () => {
  it("phân loại lỗi vĩnh viễn / tạm thời", () => {
    expect(classifyIngestError(new IngestError("tệp hỏng"))).toEqual({ message: "tệp hỏng", permanent: true });
    expect(classifyIngestError(new IngestError("mạng", { permanent: false })).permanent).toBe(false);
    expect(classifyIngestError(new AiNotConfiguredError()).permanent).toBe(true);
    expect(classifyIngestError(new AiProviderError("key sai", 401)).permanent).toBe(true);
    expect(classifyIngestError(new AiProviderError("hết quota", 429)).permanent).toBe(false);
    expect(classifyIngestError(new AiProviderError("lỗi máy chủ", 503)).permanent).toBe(false);
    expect(classifyIngestError(new Error("lạ"))).toEqual({ message: "lạ", permanent: false });
  });
});
