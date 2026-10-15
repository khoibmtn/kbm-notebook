/**
 * Hậu kiểm trích dẫn `[n]` cho artifact (docs/02 §3.3, bước 4) — thuần hàm, dùng được ở client + server.
 *
 * Model nhận bằng chứng đánh số 1..N và có thể viết `[3]`, `[1, 2]`, `[2-4]`. Ta:
 *  1. chuẩn hoá thành các chip `[a][b]`,
 *  2. bỏ số không tồn tại,
 *  3. đánh số lại gọn theo thứ tự xuất hiện đầu tiên → `content.evidence` chỉ chứa bằng chứng thật sự được trích.
 */
import type { ArtifactEvidence } from "./content";

/** `[1]`, `[1, 2]`, `[1,2]`, `[2-4]`, `[1; 3]`; không khớp `[1](url)` (liên kết). Khối code và `code` inline được bỏ qua. */
const MARKER_RE = /([ \t]?)\[(\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*)\](?!\()/g;

function expandMarker(inner: string): number[] {
  const out: number[] = [];
  for (const part of inner.split(/[,;]/)) {
    const range = part.trim().match(/^(\d+)\s*[–-]\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (b >= a && b - a <= 20) for (let n = a; n <= b; n++) out.push(n);
      else out.push(a, b);
    } else if (part.trim()) {
      out.push(Number(part.trim()));
    }
  }
  return out;
}

/** Áp `fn` lên phần văn bản nằm ngoài khối code (```) và code inline, giữ nguyên phần code. */
function mapOutsideCode(md: string, fn0: (text: string) => string): string {
  const fn = (text: string) =>
    text
      .split(/(`[^`\n]*`)/)
      .map((seg, i) => (i % 2 === 1 ? seg : fn0(seg)))
      .join("");
  const lines = md.split("\n");
  const out: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    if (buf.length) out.push(fn(buf.join("\n")));
    buf = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (!inFence) {
        flush();
        inFence = true;
        out.push(line);
      } else {
        out.push(line);
        inFence = false;
      }
      continue;
    }
    if (inFence) out.push(line);
    else buf.push(line);
  }
  flush();
  return out.join("\n");
}

/** Các số trích dẫn xuất hiện trong markdown (theo thứ tự, có lặp). */
export function extractMarkdownCitations(md: string): number[] {
  const nums: number[] = [];
  mapOutsideCode(md, (text) => {
    for (const m of text.matchAll(MARKER_RE)) nums.push(...expandMarker(m[2]));
    return text;
  });
  return nums;
}

/**
 * Bộ ánh xạ trích dẫn: nhận số gốc (1..N theo bằng chứng đã đưa cho model) → số mới gọn theo thứ tự dùng đầu tiên.
 * `use(n)` trả null nếu `n` không hợp lệ (không nằm trong 1..N).
 */
export class CitationRemapper {
  private readonly map = new Map<number, number>();
  private readonly usedEvidence: ArtifactEvidence[] = [];

  constructor(private readonly evidence: readonly ArtifactEvidence[]) {}

  /** Số mới (1-based) hoặc null nếu số gốc không hợp lệ. */
  use(n: number): number | null {
    if (!Number.isInteger(n) || n < 1 || n > this.evidence.length) return null;
    let mapped = this.map.get(n);
    if (mapped === undefined) {
      this.usedEvidence.push(this.evidence[n - 1]);
      mapped = this.usedEvidence.length;
      this.map.set(n, mapped);
    }
    return mapped;
  }

  /** Danh sách số (vd `citations` của câu hỏi): loại số sai/trùng, đánh số lại. `undefined` nếu rỗng. */
  list(nums: readonly number[] | undefined | null): number[] | undefined {
    if (!nums?.length) return undefined;
    const out: number[] = [];
    for (const n of nums) {
      const m = this.use(n);
      if (m !== null && !out.includes(m)) out.push(m);
    }
    return out.length ? out : undefined;
  }

  /** Chuẩn hoá + đánh số lại mọi `[n]` trong markdown; bỏ `[n]` không hợp lệ. */
  markdown(md: string): string {
    return mapOutsideCode(md, (text) =>
      text.replace(MARKER_RE, (_m, ws: string, inner: string) => {
        const mapped: number[] = [];
        for (const n of expandMarker(inner)) {
          const m = this.use(n);
          if (m !== null && !mapped.includes(m)) mapped.push(m);
        }
        // trích dẫn không hợp lệ bị xoá cùng khoảng trắng đứng trước để không còn "câu ."
        return mapped.length ? ws + mapped.map((m) => `[${m}]`).join("") : "";
      }),
    );
  }

  /** Bằng chứng đã được dùng, theo số mới. */
  get used(): ArtifactEvidence[] {
    return this.usedEvidence;
  }
}

/** Tách markdown thành các đoạn thường + chip trích dẫn để render (`[n]` đã được chuẩn hoá `[1][2]`). */
export function splitCitationMarkers(text: string): Array<{ type: "text"; value: string } | { type: "cite"; n: number }> {
  const parts: Array<{ type: "text"; value: string } | { type: "cite"; n: number }> = [];
  let last = 0;
  for (const m of text.matchAll(MARKER_RE)) {
    const idx = (m.index ?? 0) + m[1].length;
    if (idx > last) parts.push({ type: "text", value: text.slice(last, idx) });
    for (const n of expandMarker(m[2])) parts.push({ type: "cite", n });
    last = (m.index ?? 0) + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}
