import "server-only";
import { ApiError } from "@/server/api/errors";
import type {
  EnterpriseClient,
  EnterpriseNotebook,
  EnterpriseShareRole,
  EnterpriseSource,
  EnterpriseSourceInput,
} from "@/server/connectors/enterprise-client";
import type { Evidence, KnowledgeProvider, RetrieveQuery } from "./types";

export const ENTERPRISE_NO_CHAT_MESSAGE =
  "NotebookLM Enterprise API (v1alpha, Preview) chỉ quản lý notebook, nguồn và chia sẻ — không có endpoint hỏi đáp (chat). Hãy dùng NotebookLM Bridge nếu muốn hỏi đáp qua NotebookLM.";

/**
 * Kho tri thức NotebookLM Enterprise: **không** hỗ trợ truy hồi/hỏi đáp (không có chat API) → `retrieve()` ném `501 not_supported`.
 * Chỉ cung cấp tiện ích liệt kê / tạo notebook / thêm nguồn / chia sẻ.
 */
export class NotebookLmEnterpriseProvider implements KnowledgeProvider {
  readonly kind = "notebooklm-enterprise" as const;

  constructor(
    private readonly client: Pick<EnterpriseClient, "listNotebooks" | "getNotebook" | "createNotebook" | "addSources" | "share">,
    readonly externalId?: string,
  ) {}

  async retrieve(_q: RetrieveQuery): Promise<Evidence[]> {
    void _q;
    throw new ApiError(501, "not_supported", ENTERPRISE_NO_CHAT_MESSAGE);
  }

  listNotebooks(): Promise<EnterpriseNotebook[]> {
    return this.client.listNotebooks();
  }

  async listSources(notebookId = this.requireExternalId()): Promise<EnterpriseSource[]> {
    return (await this.client.getNotebook(notebookId)).sources;
  }

  createNotebook(title: string): Promise<EnterpriseNotebook> {
    return this.client.createNotebook(title);
  }

  addSource(input: EnterpriseSourceInput, notebookId = this.requireExternalId()): Promise<void> {
    return this.client.addSources(notebookId, [input]);
  }

  share(accounts: { email: string; role: EnterpriseShareRole }[], notebookId = this.requireExternalId()): Promise<void> {
    return this.client.share(notebookId, accounts);
  }

  private requireExternalId(): string {
    if (!this.externalId) throw new ApiError(400, "bad_request", "Thiếu ID notebook Enterprise");
    return this.externalId;
  }
}
