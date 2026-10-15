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

export type Evidence = {
  id: string;
  provider: "local" | "web" | "notebooklm-bridge" | "notebooklm-enterprise";
  sourceId: string | null;
  sourceTitle: string;
  locator: EvidenceLocator;
  text: string;
  score: number;
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
