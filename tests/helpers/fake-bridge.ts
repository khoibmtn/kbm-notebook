import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Bridge giả cho test: một máy chủ HTTP nhỏ hiện thực ĐÚNG hợp đồng JSON của sidecar `bridge/notebooklm`
 * (bearer token, `/health`, `/notebooks`, `/notebooks/{id}[/sources|/ask|/notes]`, `/notebooks/{id}/sources/{sid}/fulltext`).
 * Không phải dữ liệu giả trong sản phẩm — chỉ dùng trong test/e2e vì sandbox không đăng nhập được Google thật.
 */

export type FakeSource = { id: string; title: string; kind: string; status: string; url: string | null; fulltext?: string };
export type FakeReference = {
  source_id: string;
  source_title?: string | null;
  citation_number?: number | null;
  cited_text?: string | null;
  start_char?: number | null;
  end_char?: number | null;
};
export type FakeNotebook = { id: string; title: string; sources: FakeSource[]; notes: { id: string; title: string; content: string }[] };

export type FakeBridge = {
  url: string;
  token: string;
  port: number;
  /** Trạng thái đăng nhập Google của bridge (ảnh hưởng `/health` và các route cần đăng nhập). */
  authenticated: boolean;
  account: string;
  notebooks: Map<string, FakeNotebook>;
  /** Câu trả lời + trích dẫn của `/ask`; hàm nhận câu hỏi. */
  askAnswer: (question: string, notebookId: string) => { answer: string; references: FakeReference[] };
  /** Nếu đặt, `/ask` trả lỗi này (status + body bridge) thay vì kết quả. */
  askFailure: { status: number; code: string; message: string } | null;
  /** Mô phỏng sidecar cũ chưa có endpoint fulltext. */
  fulltextSupported: boolean;
  /** Nhật ký request (method, path, body đã parse nếu JSON). */
  calls: { method: string; path: string; body: unknown; auth: string | undefined }[];
  addNotebook(id: string, title: string, sources?: Partial<FakeSource>[]): FakeNotebook;
  close(): Promise<void>;
};

const BRIDGE_TOKEN = "fake-bridge-token-0123456789";

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Dạng JSON công khai của nguồn (không có `fulltext`). */
function publicSource(s: FakeSource) {
  return { id: s.id, title: s.title, kind: s.kind, status: s.status, url: s.url };
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}
const err = (res: http.ServerResponse, status: number, code: string, message: string) => send(res, status, { error: { code, message } });

export async function startFakeBridge(opts: { port?: number } = {}): Promise<FakeBridge> {
  let seq = 100;
  const state: FakeBridge = {
    url: "",
    token: BRIDGE_TOKEN,
    port: 0,
    authenticated: true,
    account: "nguoi.dung@example.com",
    notebooks: new Map(),
    askAnswer: (q) => ({ answer: `Trả lời cho: ${q}`, references: [] }),
    askFailure: null,
    fulltextSupported: true,
    calls: [],
    addNotebook(id, title, sources = []) {
      const nb: FakeNotebook = {
        id,
        title,
        notes: [],
        sources: sources.map((s, i) => ({
          id: s.id ?? `${id}-s${i + 1}`,
          title: s.title ?? `Nguồn ${i + 1}`,
          kind: s.kind ?? "pdf",
          status: s.status ?? "ready",
          url: s.url ?? null,
          fulltext: s.fulltext,
        })),
      };
      state.notebooks.set(id, nb);
      return nb;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const ctype = String(req.headers["content-type"] ?? "");
      let body: unknown = null;
      if (raw.length > 0 && ctype.includes("json")) {
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          body = null;
        }
      } else if (raw.length > 0 && ctype.includes("multipart/form-data")) {
        body = { multipart: raw.toString("latin1") };
      }
      state.calls.push({ method: req.method ?? "GET", path, body, auth: req.headers.authorization });

      if (req.headers.authorization !== `Bearer ${state.token}`) return err(res, 401, "unauthorized", "Missing or invalid bearer token.");

      if (req.method === "GET" && path === "/health") {
        return send(res, 200, {
          ok: true,
          version: "0.1.0",
          notebooklm_py_version: "0.8.5",
          authenticated: state.authenticated,
          ...(state.authenticated ? { account: state.account } : { detail: "Run `notebooklm login`" }),
        });
      }
      if (!state.authenticated) return err(res, 503, "not_authenticated", "Bridge chưa đăng nhập Google. Run `notebooklm login`.");

      if (req.method === "GET" && path === "/notebooks") {
        return send(
          res,
          200,
          [...state.notebooks.values()].map((n) => ({ id: n.id, title: n.title, source_count: n.sources.length, updated_at: null, created_at: null })),
        );
      }

      const m = /^\/notebooks\/([^/]+)(?:\/(.*))?$/.exec(path);
      if (!m) return err(res, 404, "not_found", "Not found");
      const nbId = decodeURIComponent(m[1]);
      const rest = m[2] ?? "";
      const nb = state.notebooks.get(nbId);
      if (!nb) return err(res, 404, "notebook_not_found", `Notebook ${nbId} not found`);

      if (req.method === "GET" && rest === "") {
        return send(res, 200, {
          id: nb.id,
          title: nb.title,
          source_count: nb.sources.length,
          updated_at: null,
          created_at: null,
          sources: nb.sources.map(publicSource),
        });
      }
      if (req.method === "GET" && rest === "sources") {
        return send(res, 200, nb.sources.map(publicSource));
      }
      if (req.method === "POST" && rest === "sources") {
        const id = `${nb.id}-s${++seq}`;
        let src: FakeSource;
        if (ctype.includes("multipart/form-data")) {
          const text = (body as { multipart: string }).multipart;
          const fileName = /filename="([^"]+)"/.exec(text)?.[1] ?? "upload";
          src = { id, title: fileName, kind: "pdf", status: "processing", url: null };
        } else {
          const b = body as { type?: string; title?: string; text?: string; url?: string } | null;
          if (b?.type === "text") src = { id, title: b.title ?? "Văn bản", kind: "pasted_text", status: "processing", url: null, fulltext: b.text };
          else if (b?.type === "url") src = { id, title: b.title ?? b.url ?? "URL", kind: "web_page", status: "processing", url: b.url ?? null };
          else return err(res, 422, "invalid_request", "type must be text or url");
        }
        nb.sources.push(src);
        return send(res, 201, publicSource(src));
      }
      const ft = /^sources\/([^/]+)\/fulltext$/.exec(rest);
      if (req.method === "GET" && ft) {
        if (!state.fulltextSupported) return err(res, 404, "not_found", "Not found");
        const src = nb.sources.find((s) => s.id === decodeURIComponent(ft[1]));
        if (!src) return err(res, 404, "source_not_found", `Source ${ft[1]} not found in notebook.`);
        const text = src.fulltext ?? `Toàn văn của ${src.title}.`;
        return send(res, 200, { source_id: src.id, title: src.title, kind: src.kind, url: src.url, text, char_count: text.length });
      }
      if (req.method === "POST" && rest === "ask") {
        if (state.askFailure) return err(res, state.askFailure.status, state.askFailure.code, state.askFailure.message);
        const b = body as { question?: string } | null;
        if (!b?.question) return err(res, 422, "invalid_request", "question is required");
        const out = state.askAnswer(b.question, nb.id);
        return send(res, 200, {
          answer: out.answer,
          conversation_id: "conv-1",
          references: out.references.map((r) => ({
            source_title: nb.sources.find((s) => s.id === r.source_id)?.title ?? null,
            citation_number: null,
            cited_text: null,
            start_char: null,
            end_char: null,
            ...r,
          })),
        });
      }
      if (req.method === "POST" && rest === "notes") {
        const b = body as { title?: string; content?: string } | null;
        if (!b?.title) return err(res, 422, "invalid_request", "title is required");
        const note = { id: `note-${++seq}`, title: b.title, content: b.content ?? "" };
        nb.notes.push(note);
        return send(res, 201, { id: note.id, title: note.title, content: note.content, created_at: null });
      }
      return err(res, 404, "not_found", "Not found");
    })().catch((e: unknown) => err(res, 500, "internal_error", e instanceof Error ? e.message : "error"));
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  state.port = port;
  state.url = `http://127.0.0.1:${port}`;
  return state;
}
