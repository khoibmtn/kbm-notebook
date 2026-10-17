"use client";
import { AlertCircle, FileText, Loader2, Presentation, Search, Sheet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { connectGoogleDrive } from "@/lib/auth-client";
import { GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDES, type DriveFileDto, type DriveFilesPage, type DriveImportResult } from "@/lib/drive";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import type { SourceVisibility } from "@/lib/sources";

type Problem = { kind: "google_not_configured" | "not_connected" | "reauth" | "error"; message: string };

const NEEDS_CONNECT = new Set(["drive_not_connected", "drive_scope_missing", "drive_reauth_required"]);

function FileIcon({ mime }: { mime: string }) {
  if (mime === GOOGLE_SLIDES || mime.includes("presentation")) return <Presentation className="size-4 shrink-0 text-orange-600" aria-hidden />;
  if (mime === GOOGLE_SHEET || mime.includes("spreadsheet") || mime === "text/csv") return <Sheet className="size-4 shrink-0 text-green-600" aria-hidden />;
  if (mime === GOOGLE_DOC || mime.includes("wordprocessing")) return <FileText className="size-4 shrink-0 text-blue-600" aria-hidden />;
  return <FileText className="size-4 shrink-0 text-red-600" aria-hidden />;
}

type Props = {
  notebookId: string;
  visibility: SourceVisibility;
  /** Gọi sau khi nhập xong (để tải lại danh sách nguồn). */
  onImported: (result: DriveImportResult) => void;
};

/** Tab "Từ Google Drive": liệt kê tệp gần đây / tìm kiếm bằng token Drive đã lưu, chọn nhiều tệp để nhập. */
export function DriveImportPanel({ notebookId, visibility, onImported }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const [files, setFiles] = useState<DriveFileDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const seq = useRef(0);

  const fetchPage = useCallback(
    async (q: string, pageToken?: string): Promise<{ page: DriveFilesPage } | { problem: Problem }> => {
      try {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        if (pageToken) params.set("pageToken", pageToken);
        return { page: await api<DriveFilesPage>(`/api/notebooks/${notebookId}/drive/files${params.size ? `?${params}` : ""}`) };
      } catch (e) {
        const code = e instanceof ApiClientError ? e.code : "";
        const message = errorMessage(e, t("common.error"));
        if (code === "google_not_configured") return { problem: { kind: "google_not_configured", message } };
        if (NEEDS_CONNECT.has(code)) return { problem: { kind: code === "drive_reauth_required" ? "reauth" : "not_connected", message } };
        return { problem: { kind: "error", message } };
      }
    },
    [notebookId, t],
  );

  const apply = useCallback((mine: number, r: { page: DriveFilesPage } | { problem: Problem }, append: boolean) => {
    if (mine !== seq.current) return;
    if ("problem" in r) {
      setProblem(r.problem);
      setFiles(null);
    } else {
      setProblem(null);
      setFiles((cur) => (append ? [...(cur ?? []), ...r.page.files] : r.page.files));
      setNext(r.page.nextPageToken);
    }
    setLoading(false);
  }, []);

  const load = useCallback(
    async (q: string, pageToken?: string) => {
      const mine = ++seq.current;
      setLoading(true);
      apply(mine, await fetchPage(q, pageToken), Boolean(pageToken));
    },
    [apply, fetchPage],
  );

  useEffect(() => {
    const mine = ++seq.current;
    let cancelled = false;
    void fetchPage("").then((r) => {
      if (!cancelled) apply(mine, r, false);
    });
    return () => {
      cancelled = true;
    };
  }, [apply, fetchPage]);

  async function runImport() {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const res = await api<DriveImportResult>(`/api/notebooks/${notebookId}/drive/import`, {
        method: "POST",
        json: { fileIds: [...selected], visibility },
      });
      if (res.imported.length > 0) toast.success(t("connectors.drive.imported", { count: res.imported.length }));
      for (const f of res.failed) toast.error(t("connectors.drive.importFailed", { message: f.message }));
      setSelected(new Set());
      onImported(res);
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : "";
      if (NEEDS_CONNECT.has(code)) setProblem({ kind: code === "drive_reauth_required" ? "reauth" : "not_connected", message: errorMessage(e) });
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setImporting(false);
    }
  }

  async function connect() {
    try {
      await connectGoogleDrive(window.location.pathname + window.location.search);
    } catch (e) {
      toast.error(errorMessage(e, t("connectors.drive.connectFailed")));
    }
  }

  if (problem?.kind === "google_not_configured") {
    return (
      <div className="space-y-2 rounded-lg border border-dashed p-4 text-sm" data-testid="drive-not-configured">
        <p className="font-medium">{t("connectors.drive.notConfiguredTitle")}</p>
        <p className="text-muted-foreground">{t("connectors.drive.notConfigured")}</p>
      </div>
    );
  }
  if (problem && (problem.kind === "not_connected" || problem.kind === "reauth")) {
    return (
      <div className="space-y-3 rounded-lg border border-dashed p-4 text-sm" data-testid="drive-connect-cta">
        <p>{problem.kind === "reauth" ? t("connectors.drive.reauth") : t("connectors.drive.needConnect")}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void connect()} data-testid="drive-connect-button">
            {t("connectors.drive.connect")}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/settings?tab=connectors">{t("connectors.connect.openSettings")}</Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("connectors.drive.scopeHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="drive-import-panel">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setActiveQuery(query.trim());
          setSelected(new Set());
          void load(query.trim());
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("connectors.drive.search")} className="pl-8" aria-label={t("connectors.drive.search")} data-testid="drive-search" />
        </div>
        <Button type="submit" variant="outline" disabled={loading}>
          {t("connectors.drive.searchButton")}
        </Button>
      </form>

      {problem?.kind === "error" && (
        <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive" role="alert" data-testid="drive-error">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="break-words">{problem.message}</span>
        </p>
      )}

      {loading && !files && (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" aria-busy>
          <Loader2 className="size-4 animate-spin" aria-hidden /> {t("common.loading")}
        </p>
      )}

      {files && (
        <>
          <p className="text-xs font-medium text-muted-foreground">{activeQuery ? t("connectors.drive.results", { query: activeQuery }) : t("connectors.drive.recent")}</p>
          {files.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground" data-testid="drive-empty">
              {t("connectors.drive.empty")}
            </p>
          ) : (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto" data-testid="drive-files">
              {files.map((f) => (
                <li key={f.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent">
                    <Checkbox
                      checked={selected.has(f.id)}
                      onCheckedChange={(v) =>
                        setSelected((cur) => {
                          const n = new Set(cur);
                          if (v === true) n.add(f.id);
                          else n.delete(f.id);
                          return n;
                        })
                      }
                      aria-label={f.name}
                    />
                    <FileIcon mime={f.mimeType} />
                    <span className="min-w-0 flex-1 truncate" title={f.name}>
                      {f.name}
                    </span>
                    {f.modifiedTime && <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(f.modifiedTime, locale)}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {next && (
            <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(activeQuery, next)}>
              {loading && <Loader2 className="animate-spin" />} {t("connectors.drive.loadMore")}
            </Button>
          )}
          <Button disabled={selected.size === 0 || importing} onClick={() => void runImport()} data-testid="drive-import-submit">
            {importing && <Loader2 className="animate-spin" />} {t("connectors.drive.import", { count: selected.size })}
          </Button>
          <p className="text-xs text-muted-foreground">{t("connectors.drive.exportHint")}</p>
        </>
      )}
    </div>
  );
}
