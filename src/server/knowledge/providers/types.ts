import "server-only";

/** Vị trí của đoạn bằng chứng trong nguồn (dùng cho chip trích dẫn [n]). */
export type EvidenceLocator = {
  page?: number;
  slide?: number;
  section?: string;
  url?: string;
  startChar?: number;
  endChar?: number;
};

/** Loại bằng chứng: đoạn trích (mặc định), câu trả lời tổng hợp của kho ngoài (NotebookLM), hoặc kết quả web. */
export type EvidenceKind = "chunk" | "external_answer" | "web";

export type Evidence = {
  id: string;
  provider: "local" | "web" | "notebooklm-bridge" | "notebooklm-enterprise";
  /** Mặc định (không đặt) = `chunk`. `external_answer` = câu trả lời NotebookLM trả về, được ghi rõ nguồn khi trích dẫn. */
  kind?: EvidenceKind;
  /** Kết nối ngoài tạo ra bằng chứng này (`notebook_connections.id`). */
  connectionId?: string;
  /** Liên kết mở notebook ngoài (vd. `https://notebooklm.google.com/notebook/{id}`) — không có trình xem cục bộ. */
  externalUrl?: string;
  sourceId: string | null;
  sourceTitle: string;
  locator: EvidenceLocator;
  text: string;
  /** Điểm xếp hạng (provider `local`: RRF — chỉ so sánh trong cùng một lần truy vấn). */
  score: number;
  /** Độ tương đồng cosine (0–1) của vector tốt nhất nếu chunk nằm trong top vector; dùng làm ngưỡng "thiếu bằng chứng". */
  similarity?: number;
};

export type RetrieveQuery = {
  query: string;
  notebookId: string;
  sourceIds?: string[];
  topK?: number;
  userId: string;
};

/** Contract cho mọi kho tri thức (docs/02 §3.2). Triển khai ở phase P1/P5. */
export interface KnowledgeProvider {
  kind: "local" | "web" | "notebooklm-bridge" | "notebooklm-enterprise";
  retrieve(q: RetrieveQuery): Promise<Evidence[]>;
}

export class NotSupportedError extends Error {
  constructor(message = "Provider không hỗ trợ thao tác này") {
    super(message);
    this.name = "NotSupportedError";
  }
}
