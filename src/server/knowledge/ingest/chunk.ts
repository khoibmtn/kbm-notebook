import { estimateTokens } from "@/lib/sources";

/** Một đoạn văn bản có vị trí (trang / slide / mục) do extractor trả về. */
export type Segment = {
  text: string;
  page?: number;
  slide?: number;
  section?: string;
};

export type Span = {
  /** Vị trí trong `SourceDoc.text` (end loại trừ). */
  start: number;
  end: number;
  page?: number;
  slide?: number;
  section?: string;
};

/** Toàn văn nguồn + bản đồ vị trí; `start_char/end_char` của chunk tính theo `text` này. */
export type SourceDoc = { text: string; spans: Span[] };

export type Chunk = {
  idx: number;
  text: string;
  tokenCount: number;
  page?: number;
  slide?: number;
  section?: string;
  startChar: number;
  endChar: number;
};

export type ChunkOptions = {
  /** Số token mục tiêu mỗi chunk (≈ ký tự/4). Mặc định 800. */
  targetTokens?: number;
  /** Số token chồng lấn giữa hai chunk liền kề. Mặc định 120. */
  overlapTokens?: number;
};

export const DEFAULT_TARGET_TOKENS = 800;
export const DEFAULT_OVERLAP_TOKENS = 120;
const SEGMENT_SEPARATOR = "\n\n";

/** Chuẩn hoá văn bản: bỏ NUL/ký tự điều khiển (Postgres không lưu được NUL), gộp dòng trống, cắt khoảng trắng thừa. */
export function normalizeText(input: string): string {
  return (
    input
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/ /g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Ghép các segment (đã chuẩn hoá, bỏ segment rỗng) thành toàn văn + spans. */
export function buildDocument(segments: Segment[]): SourceDoc {
  let text = "";
  const spans: Span[] = [];
  for (const seg of segments) {
    const body = normalizeText(seg.text);
    if (!body) continue;
    if (text) text += SEGMENT_SEPARATOR;
    const start = text.length;
    text += body;
    spans.push({ start, end: text.length, page: seg.page, slide: seg.slide, section: seg.section });
  }
  return { text, spans };
}

type Range = { start: number; end: number };

/** Tách thành câu (vị trí tuyệt đối trong `text`), cắt theo dấu kết câu + khoảng trắng hoặc xuống dòng. */
function splitSentences(text: string, from: number, to: number): Range[] {
  const out: Range[] = [];
  const slice = text.slice(from, to);
  const re = /[.!?…。]+["')\]”’]*\s+|\n+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (s: number, e: number) => {
    // bỏ khoảng trắng đầu/cuối nhưng giữ đúng offset
    while (s < e && /\s/.test(slice[s])) s++;
    while (e > s && /\s/.test(slice[e - 1])) e--;
    if (e > s) out.push({ start: from + s, end: from + e });
  };
  while ((m = re.exec(slice)) !== null) {
    push(last, m.index + m[0].length);
    last = m.index + m[0].length;
  }
  push(last, slice.length);
  return out;
}

/** Cắt cứng một "câu" quá dài tại khoảng trắng gần nhất không vượt `maxChars`. */
function hardSplit(text: string, r: Range, maxChars: number): Range[] {
  if (r.end - r.start <= maxChars) return [r];
  const out: Range[] = [];
  let s = r.start;
  while (r.end - s > maxChars) {
    let cut = s + maxChars;
    // lùi về khoảng trắng gần nhất (trong nửa sau của cửa sổ) để không cắt giữa từ
    const minCut = s + Math.floor(maxChars / 2);
    let k = cut;
    while (k > minCut && !/\s/.test(text[k])) k--;
    if (k > minCut) cut = k;
    out.push({ start: s, end: cut });
    s = cut;
    while (s < r.end && /\s/.test(text[s])) s++;
  }
  if (s < r.end) out.push({ start: s, end: r.end });
  return out;
}

type Unit = { start: number; end: number; page?: number; slide?: number; section?: string };

/**
 * Gộp các span liền kề không có trang/slide (vd. các mục của DOCX/MD) khi vừa một chunk;
 * span có trang/slide luôn đứng riêng để số trang của chunk chính xác.
 */
function buildUnits(doc: SourceDoc, targetChars: number): Unit[] {
  const units: Unit[] = [];
  for (const sp of doc.spans) {
    const prev = units[units.length - 1];
    const positional = sp.page != null || sp.slide != null;
    if (
      prev &&
      !positional &&
      prev.page == null &&
      prev.slide == null &&
      sp.end - prev.start <= targetChars
    ) {
      prev.end = sp.end;
      continue;
    }
    units.push({ start: sp.start, end: sp.end, page: sp.page, slide: sp.slide, section: sp.section });
  }
  return units;
}

/**
 * Chia tài liệu thành các chunk ≈ `targetTokens` token, chồng lấn ≈ `overlapTokens`,
 * ưu tiên ranh giới câu, không vượt qua ranh giới trang/slide.
 */
export function chunkDocument(doc: SourceDoc, opts: ChunkOptions = {}): Chunk[] {
  const targetChars = Math.max(200, (opts.targetTokens ?? DEFAULT_TARGET_TOKENS) * 4);
  const overlapChars = Math.max(0, Math.min((opts.overlapTokens ?? DEFAULT_OVERLAP_TOKENS) * 4, Math.floor(targetChars / 2)));
  const chunks: Chunk[] = [];

  for (const unit of buildUnits(doc, targetChars)) {
    const sentences = splitSentences(doc.text, unit.start, unit.end).flatMap((s) => hardSplit(doc.text, s, targetChars));
    const n = sentences.length;
    let i = 0;
    while (i < n) {
      let j = i + 1;
      while (j < n && sentences[j].end - sentences[i].start <= targetChars) j++;
      const startChar = sentences[i].start;
      const endChar = sentences[j - 1].end;
      const text = doc.text.slice(startChar, endChar);
      chunks.push({
        idx: chunks.length,
        text,
        tokenCount: estimateTokens(text),
        page: unit.page,
        slide: unit.slide,
        section: unit.section,
        startChar,
        endChar,
      });
      if (j >= n) break;
      // chồng lấn: lùi lại tối đa overlapChars, nhưng luôn tiến ít nhất 1 câu
      let k = j;
      while (k - 1 > i && sentences[j - 1].end - sentences[k - 1].start <= overlapChars) k--;
      i = k;
    }
  }
  return chunks;
}

/** Tiện ích: segments → chunks. */
export function chunkSegments(segments: Segment[], opts?: ChunkOptions): { doc: SourceDoc; chunks: Chunk[] } {
  const doc = buildDocument(segments);
  return { doc, chunks: chunkDocument(doc, opts) };
}
