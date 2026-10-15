import "server-only";
import { externalNotebookUrl, stripBridgeMarkers } from "@/lib/connectors";
import type { BridgeAskResult, BridgeClient } from "@/server/connectors/bridge-client";
import type { Evidence, KnowledgeProvider, RetrieveQuery } from "./types";

/** Ngữ cảnh một kết nối NotebookLM Bridge (notebook ngoài đã liên kết vào sổ tay). */
export type BridgeConnectionContext = {
  connectionId: string;
  /** ID notebook trên NotebookLM. */
  externalId: string;
  /** Nhãn hiển thị của kết nối. */
  label: string;
  /** Tiêu đề nguồn đã cache (`connection_sources`) để bù khi bridge không trả `source_title`. */
  sourceTitles?: ReadonlyMap<string, string>;
};

export const BRIDGE_MAX_REFERENCES = 12;
const SECTION = "NotebookLM";

const posOrUndefined = (n: number | null): number | undefined => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined);

/**
 * `ask` của Bridge → `Evidence[]`:
 * 1) mỗi `references[]` (khử trùng lặp) → `chunk` với `sourceId` = ID nguồn ngoài, `locator {startChar, endChar, section:'NotebookLM'}`, `text = cited_text`;
 * 2) thêm một bằng chứng `external_answer` ở CUỐI = câu trả lời tổng hợp của NotebookLM (đã xoá dấu `[n]` riêng của bridge để không lẫn số trích dẫn của KBM).
 * Điểm giảm dần theo thứ tự (không so sánh được với điểm RRF của kho cục bộ — bằng chứng kết nối luôn được nối sau kho cục bộ).
 */
export function bridgeResultToEvidence(result: BridgeAskResult, ctx: BridgeConnectionContext): Evidence[] {
  const externalUrl = externalNotebookUrl("notebooklm-bridge", ctx.externalId) ?? undefined;
  const out: Evidence[] = [];
  const seen = new Set<string>();
  let rank = 0;
  for (const ref of result.references) {
    const text = (ref.citedText ?? "").trim();
    if (!text) continue;
    const key = `${ref.sourceId}|${ref.startChar ?? ""}|${ref.endChar ?? ""}|${text.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (rank >= BRIDGE_MAX_REFERENCES) break;
    out.push({
      id: `nlm:${ctx.connectionId}:${ref.sourceId}:${ref.startChar ?? 0}-${ref.endChar ?? 0}`,
      provider: "notebooklm-bridge",
      kind: "chunk",
      connectionId: ctx.connectionId,
      externalUrl,
      sourceId: ref.sourceId,
      sourceTitle: ref.sourceTitle?.trim() || ctx.sourceTitles?.get(ref.sourceId) || "Nguồn trong NotebookLM",
      locator: { startChar: posOrUndefined(ref.startChar), endChar: posOrUndefined(ref.endChar), section: SECTION },
      text,
      score: 1 / (60 + rank + 2),
    });
    rank++;
  }
  const answer = stripBridgeMarkers(result.answer);
  if (answer) {
    out.push({
      id: `nlm:${ctx.connectionId}:answer`,
      provider: "notebooklm-bridge",
      kind: "external_answer",
      connectionId: ctx.connectionId,
      externalUrl,
      sourceId: null,
      sourceTitle: `Câu trả lời của NotebookLM · ${ctx.label}`,
      locator: { section: SECTION },
      text: answer,
      score: 1 / (60 + rank + 2),
    });
  }
  return out;
}

/**
 * Kho tri thức NotebookLM Bridge (KHÔNG CHÍNH THỨC): hỏi thẳng notebook ngoài qua sidecar. Mỗi instance ứng với một kết nối.
 * Lỗi (mạng, bridge chưa đăng nhập, 4xx/5xx…) ném `ApiError(502, 'connector_error')` kèm thông báo của bridge.
 */
export class NotebookLmBridgeProvider implements KnowledgeProvider {
  readonly kind = "notebooklm-bridge" as const;

  constructor(
    private readonly ctx: BridgeConnectionContext,
    private readonly client: Pick<BridgeClient, "ask">,
  ) {}

  get connectionId(): string {
    return this.ctx.connectionId;
  }
  get label(): string {
    return this.ctx.label;
  }

  async retrieve(q: RetrieveQuery): Promise<Evidence[]> {
    const question = q.query.trim();
    if (!question) return [];
    const result = await this.client.ask(this.ctx.externalId, question);
    return bridgeResultToEvidence(result, this.ctx);
  }
}
