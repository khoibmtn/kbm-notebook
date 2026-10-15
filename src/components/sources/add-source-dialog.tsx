"use client";
import { AlertCircle, CheckCircle2, CloudUpload, Loader2, X } from "lucide-react";
import { useCallback, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { SourceTypeIcon } from "@/components/sources/source-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import { detectFileType, SOURCE_ACCEPT, type SourceDto } from "@/lib/sources";
import { uploadFormData } from "@/lib/upload";
import { cn } from "@/lib/utils";

type FileState = "waiting" | "uploading" | "done" | "rejected" | "error";
type FileItem = { key: string; file: File; state: FileState; percent: number; message?: string };

const CONCURRENCY = 2;
let seq = 0;

type Props = {
  notebookId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Giới hạn dung lượng mỗi tệp (MB) do server cấu hình. */
  maxUploadMb: number;
  /** Gọi khi có nguồn mới được tạo (để tải lại danh sách và tự chọn). */
  onAdded: (sources: SourceDto[]) => void;
};

export function AddSourceDialog({ notebookId, open, onOpenChange, maxUploadMb, onAdded }: Props) {
  const t = useT();
  const [tab, setTab] = useState("file");
  const [isPrivate, setIsPrivate] = useState(false);
  const [items, setItems] = useState<FileItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const visibility = isPrivate ? "private" : "shared";
  const base = `/api/notebooks/${notebookId}/sources`;

  const patchItem = useCallback((key: string, patch: Partial<FileItem>) => {
    setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }, []);

  const uploadOne = useCallback(
    async (item: FileItem): Promise<SourceDto[]> => {
      patchItem(item.key, { state: "uploading", percent: 0 });
      const form = new FormData();
      form.append("files", item.file);
      form.append("visibility", visibility);
      try {
        const res = await uploadFormData<{ sources: SourceDto[] }>(`${base}/upload`, form, (f) =>
          patchItem(item.key, { percent: Math.round(f * 100) }),
        );
        patchItem(item.key, { state: "done", percent: 100 });
        return res.sources;
      } catch (e) {
        const status = e instanceof ApiClientError ? e.status : 0;
        const message =
          status === 413
            ? t("sources.toast.tooLarge", { name: item.file.name, max: maxUploadMb })
            : status === 415
              ? t("sources.toast.unsupported", { name: item.file.name })
              : t("sources.toast.uploadFailed", { name: item.file.name, error: errorMessage(e, t("common.error")) });
        patchItem(item.key, { state: "error", message });
        toast.error(message);
        return [];
      }
    },
    [base, maxUploadMb, patchItem, t, visibility],
  );

  const addFiles = useCallback(
    async (list: File[]) => {
      if (list.length === 0) return;
      const queue: FileItem[] = [];
      const all: FileItem[] = list.map((file) => {
        const key = `f${++seq}`;
        if (!detectFileType(file.name, file.type)) {
          const message = t("sources.toast.unsupported", { name: file.name });
          toast.error(message);
          return { key, file, state: "rejected" as const, percent: 0, message };
        }
        if (file.size > maxUploadMb * 1024 * 1024) {
          const message = t("sources.toast.tooLarge", { name: file.name, max: maxUploadMb });
          toast.error(message);
          return { key, file, state: "rejected" as const, percent: 0, message };
        }
        const item: FileItem = { key, file, state: "waiting", percent: 0 };
        queue.push(item);
        return item;
      });
      setItems((cur) => [...cur, ...all]);

      const created: SourceDto[] = [];
      let next = 0;
      const worker = async () => {
        while (next < queue.length) {
          const item = queue[next++];
          created.push(...(await uploadOne(item)));
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
      if (created.length > 0) {
        toast.success(t("sources.toast.added", { count: created.length }));
        onAdded(created);
      }
    },
    [maxUploadMb, onAdded, t, uploadOne],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void addFiles([...e.dataTransfer.files]);
  };

  /* --- URL --- */
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const submitUrl = async () => {
    setUrlBusy(true);
    try {
      const res = await api<{ source: SourceDto }>(base, { method: "POST", json: { kind: "url", url: url.trim(), visibility } });
      toast.success(t("sources.toast.added", { count: 1 }));
      onAdded([res.source]);
      setUrl("");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setUrlBusy(false);
    }
  };

  /* --- Văn bản dán --- */
  const [textTitle, setTextTitle] = useState("");
  const [text, setText] = useState("");
  const [textBusy, setTextBusy] = useState(false);
  const submitText = async () => {
    setTextBusy(true);
    try {
      const res = await api<{ source: SourceDto }>(base, {
        method: "POST",
        json: { kind: "text", title: textTitle.trim(), text, visibility },
      });
      toast.success(t("sources.toast.added", { count: 1 }));
      onAdded([res.source]);
      setTextTitle("");
      setText("");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setTextBusy(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) setItems((cur) => cur.filter((i) => i.state === "uploading" || i.state === "waiting"));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="add-source-dialog">
        <DialogHeader>
          <DialogTitle>{t("sources.add.title")}</DialogTitle>
          <DialogDescription>{t("sources.add.description")}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="file">{t("sources.add.tabFile")}</TabsTrigger>
            <TabsTrigger value="url">{t("sources.add.tabUrl")}</TabsTrigger>
            <TabsTrigger value="text">{t("sources.add.tabText")}</TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="space-y-3">
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              data-testid="source-dropzone"
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center outline-none transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                dragging && "border-primary bg-primary/5",
              )}
            >
              <CloudUpload className="size-8 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">{dragging ? t("sources.add.dropActive") : t("sources.add.dropTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("sources.add.dropHint", { max: maxUploadMb })}</p>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={SOURCE_ACCEPT}
                className="sr-only"
                data-testid="source-file-input"
                onChange={(e) => {
                  void addFiles([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
            </div>

            {items.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label={t("sources.add.tabFile")}>
                {items.map((i) => (
                  <li key={i.key} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm" data-state={i.state}>
                    <SourceTypeIcon source={{ kind: "file", fileType: detectFileType(i.file.name, i.file.type) }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate leading-5">{i.file.name}</p>
                      {i.state === "uploading" && (
                        <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={i.percent}>
                          <div className="h-full bg-primary transition-[width]" style={{ width: `${i.percent}%` }} />
                        </div>
                      )}
                      {(i.state === "rejected" || i.state === "error") && (
                        <p className="truncate text-xs text-destructive" title={i.message}>
                          {i.message}
                        </p>
                      )}
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      {i.state === "waiting" && t("sources.add.fileWaiting")}
                      {i.state === "uploading" && (
                        <>
                          <Loader2 className="size-3 animate-spin" aria-hidden />
                          {t("sources.add.fileUploading", { percent: i.percent })}
                        </>
                      )}
                      {i.state === "done" && (
                        <>
                          <CheckCircle2 className="size-3.5 text-green-600" aria-hidden />
                          {t("sources.add.fileDone")}
                        </>
                      )}
                      {(i.state === "rejected" || i.state === "error") && <AlertCircle className="size-3.5 text-destructive" aria-hidden />}
                    </span>
                    {i.state !== "uploading" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={t("sources.add.removeFile", { name: i.file.name })}
                        onClick={() => setItems((cur) => cur.filter((x) => x.key !== i.key))}
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="url" className="space-y-3">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitUrl();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="source-url">{t("sources.add.urlLabel")}</Label>
                <Input
                  id="source-url"
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t("sources.add.urlPlaceholder")}
                  required
                />
                <p className="text-xs text-muted-foreground">{t("sources.add.urlHint")}</p>
              </div>
              <Button type="submit" disabled={urlBusy || !url.trim()}>
                {urlBusy && <Loader2 className="animate-spin" />}
                {t("sources.add.urlSubmit")}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="text" className="space-y-3">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitText();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="source-text-title">{t("sources.add.textTitleLabel")}</Label>
                <Input
                  id="source-text-title"
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                  placeholder={t("sources.add.textTitlePlaceholder")}
                  maxLength={200}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="source-text-body">{t("sources.add.textLabel")}</Label>
                <Textarea
                  id="source-text-body"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t("sources.add.textPlaceholder")}
                  rows={8}
                  required
                />
              </div>
              <Button type="submit" disabled={textBusy || !textTitle.trim() || !text.trim()}>
                {textBusy && <Loader2 className="animate-spin" />}
                {t("sources.add.textSubmit")}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
          <div>
            <Label htmlFor="source-private" className="text-sm">
              {t("sources.add.private")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("sources.add.privateHint")}</p>
          </div>
          <Switch id="source-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
