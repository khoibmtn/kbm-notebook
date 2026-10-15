import "server-only";

/**
 * Bộ dựng JSON artifact CHO MOCK (dev/e2e, `AI_PROVIDER=mock`): lấy các câu có thật trong phần "NGUỒN" của prompt
 * rồi đóng gói theo schema từng loại, mọi tiêu đề gắn "[mock]". Không phải đầu ra AI thật — chỉ để chạy được
 * toàn bộ luồng (job → phiên bản → editor → xuất) khi chưa có khoá AI.
 */

type SourceBlock = { n: number; title: string; sentences: string[] };

/** Tách phần NGUỒN của prompt thành các khối `[n] Nguồn: "tiêu đề" …`. */
export function parseNumberedContext(prompt: string): SourceBlock[] {
  const idx = prompt.lastIndexOf("NGUỒN:\n");
  const ctx = idx >= 0 ? prompt.slice(idx + "NGUỒN:\n".length) : prompt;
  const blocks: SourceBlock[] = [];
  const re = /^\[(\d+)\] Nguồn: "([^"\n]*)"[^\n]*\n([\s\S]*?)(?=\n\n\[\d+\] Nguồn: "|$)/gm;
  for (const m of ctx.matchAll(re)) {
    const sentences = m[3]
      .split(/(?<=[.!?。])\s+|\n+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length >= 20);
    blocks.push({ n: Number(m[1]), title: m[2], sentences });
  }
  return blocks;
}

type Fact = { n: number; text: string; title: string };

function facts(blocks: SourceBlock[], limit: number): Fact[] {
  const out: Fact[] = [];
  const maxLen = Math.max(...blocks.map((b) => b.sentences.length), 0);
  for (let i = 0; i < maxLen && out.length < limit; i++) {
    for (const b of blocks) {
      const s = b.sentences[i];
      if (s && out.length < limit) out.push({ n: b.n, text: s.slice(0, 280), title: b.title });
    }
  }
  return out;
}

function optionCount(prompt: string, fallback: number): number {
  const m = prompt.match(/đúng (\d+) /);
  return m ? Number(m[1]) : fallback;
}

export function buildMockArtifactJson(type: string, prompt: string): unknown | undefined {
  const blocks = parseNumberedContext(prompt);
  const fs = facts(blocks, 40);
  if (fs.length === 0) return undefined;
  const firstTitle = blocks[0].title;

  switch (type) {
    case "note":
    case "report":
    case "study_guide":
    case "faq":
    case "timeline": {
      const heading =
        type === "faq" ? "Câu hỏi thường gặp" : type === "timeline" ? "Dòng thời gian" : type === "study_guide" ? "Hướng dẫn học tập" : type === "note" ? "Ghi chú" : "Báo cáo";
      const lines: string[] = [`# ${heading} (mock): ${firstTitle}`, ""];
      if (type === "faq") {
        fs.slice(0, 8).forEach((f, i) => lines.push(`**Câu ${i + 1}: ${f.text.split(" ").slice(0, 8).join(" ")}…?**`, "", `${f.text} [${f.n}]`, ""));
      } else if (type === "timeline") {
        fs.slice(0, 8).forEach((f, i) => lines.push(`- **Mốc ${i + 1}:** ${f.text} [${f.n}]`));
      } else {
        lines.push("## Tóm tắt", "", `${fs[0].text} [${fs[0].n}]`, "", "## Các điểm chính", "");
        fs.slice(1, 10).forEach((f) => lines.push(`- ${f.text} [${f.n}]`));
        lines.push("", "## Kết luận", "", `Nội dung trên được tổng hợp từ ${blocks.length} đoạn nguồn. Một trích dẫn không tồn tại [99] sẽ bị hậu kiểm loại bỏ.`);
      }
      return { title: `[mock] ${heading}: ${firstTitle}`.slice(0, 120), markdown: lines.join("\n") };
    }
    case "quiz": {
      const count = Math.min(optionCount(prompt, 5), fs.length, 20);
      const types: Array<"mcq" | "tf" | "short"> = [];
      if (/trắc nghiệm một đáp án \(mcq\)/.test(prompt)) types.push("mcq");
      if (/đúng\/sai \(tf\)/.test(prompt)) types.push("tf");
      if (/trả lời ngắn \(short\)/.test(prompt)) types.push("short");
      if (types.length === 0) types.push("mcq");
      const questions = fs.slice(0, count).map((f, i) => {
        const t = types[i % types.length];
        if (t === "tf") {
          return {
            type: "tf" as const,
            stem: `Đúng hay sai: "${f.text}"`,
            answer: "true",
            explanation: `Nguồn "${f.title}" nêu đúng như vậy.`,
            citations: [f.n],
            difficulty: "medium" as const,
          };
        }
        if (t === "short") {
          return {
            type: "short" as const,
            stem: `Nêu ý chính của đoạn nguồn bắt đầu bằng "${f.text.split(" ").slice(0, 6).join(" ")}…".`,
            answer: f.text,
            explanation: `Theo nguồn "${f.title}".`,
            citations: [f.n],
            difficulty: "medium" as const,
          };
        }
        const distractors = fs.filter((x) => x.text !== f.text).slice(i, i + 3).map((x) => x.text);
        while (distractors.length < 3) distractors.push(`Phát biểu không có trong nguồn (${distractors.length + 1})`);
        const answerPos = i % 4;
        const texts = [...distractors];
        texts.splice(answerPos, 0, f.text);
        return {
          type: "mcq" as const,
          stem: "Phát biểu nào sau đây được nêu trong nguồn?",
          options: texts.map((text, k) => ({ key: "ABCD"[k], text })),
          answer: "ABCD"[answerPos],
          explanation: `Nguồn "${f.title}" nêu: "${f.text}"`,
          citations: [f.n],
          difficulty: "medium" as const,
        };
      });
      return { title: `[mock] Bài kiểm tra: ${firstTitle}`.slice(0, 120), questions };
    }
    case "flashcards": {
      const count = Math.min(optionCount(prompt, 8), fs.length, 40);
      return {
        title: `[mock] Thẻ ghi nhớ: ${firstTitle}`.slice(0, 120),
        cards: fs.slice(0, count).map((f) => ({
          front: `${f.text.split(" ").slice(0, 7).join(" ")}…?`,
          back: f.text,
          hint: f.title,
          tags: ["mock"],
          citations: [f.n],
        })),
      };
    }
    case "mindmap": {
      const nodes: Array<{ id: string; parentId: string | null; label: string; note?: string; citations?: number[] }> = [
        { id: "n0", parentId: null, label: firstTitle.slice(0, 40) },
      ];
      fs.slice(0, 6).forEach((f, i) => {
        const words = f.text.split(" ");
        nodes.push({ id: `b${i}`, parentId: "n0", label: words.slice(0, 4).join(" "), citations: [f.n] });
        nodes.push({ id: `c${i}`, parentId: `b${i}`, label: words.slice(4, 9).join(" ") || "chi tiết", note: f.text });
      });
      return { title: `[mock] Sơ đồ tư duy: ${firstTitle}`.slice(0, 120), nodes };
    }
    case "data_table": {
      return {
        title: `[mock] Bảng dữ liệu: ${firstTitle}`.slice(0, 120),
        columns: [
          { key: "nguon", label: "Nguồn" },
          { key: "noi_dung", label: "Nội dung" },
        ],
        rows: fs.slice(0, 10).map((f) => ({ cells: [f.title, f.text], citations: [f.n] })),
      };
    }
    default:
      return undefined;
  }
}
