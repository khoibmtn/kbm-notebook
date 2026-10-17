"use client";
import { ArrowUp, ChevronDown, Globe, Plug, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SourceTypeIcon } from "@/components/sources/source-icon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ConnectionDto } from "@/lib/connectors";
import { useT } from "@/lib/i18n-client";
import type { SourceDto } from "@/lib/sources";
import { cn } from "@/lib/utils";

const MAX_ROWS_PX = 192;

export type ComposerProps = {
  disabled?: boolean;
  streaming: boolean;
  onSend: (text: string) => Promise<boolean> | boolean;
  onStop: () => void;
  /** Nguồn `ready` đang có trong sổ tay. */
  readySources: SourceDto[];
  selectedIds: string[];
  onToggleSource: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  allowWeb: boolean;
  useWeb: boolean;
  onUseWebChange: (v: boolean) => void;
  /** Kết nối ngoài dùng được (của mình hoặc đã chia sẻ). Bỏ trống/undefined = chưa tải. */
  connections?: ConnectionDto[];
  selectedConnectionIds?: string[];
  onToggleConnection?: (id: string) => void;
  models: string[];
  model: string | null;
  onModelChange: (m: string) => void;
  /** Văn bản điền sẵn (gợi ý câu hỏi). */
  prefill?: { text: string; nonce: number } | null;
};

export function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
  readySources,
  selectedIds,
  onToggleSource,
  onSelectAll,
  allowWeb,
  useWeb,
  onUseWebChange,
  connections = [],
  selectedConnectionIds = [],
  onToggleConnection,
  models,
  model,
  onModelChange,
  prefill,
}: ComposerProps) {
  const t = useT();
  const [value, setValue] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Tự giãn chiều cao theo nội dung.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, [value]);

  useEffect(() => {
    if (prefill?.text) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- điền sẵn câu hỏi gợi ý khi người dùng bấm
      setValue(prefill.text);
      ref.current?.focus();
    }
  }, [prefill]);

  const readyIdSet = useMemo(() => new Set(readySources.map((s) => s.id)), [readySources]);
  const selectedReady = selectedIds.filter((id) => readyIdSet.has(id));
  const allSelected = readySources.length > 0 && selectedReady.length === readySources.length;

  async function submit() {
    const text = value.trim();
    if (!text || streaming || disabled) return;
    setValue("");
    const ok = await onSend(text);
    if (!ok) setValue(text);
  }

  const usableConnections = connections.filter((c) => c.usable);
  const selectedConnections = usableConnections.filter((c) => c.supportsChat && selectedConnectionIds.includes(c.id));
  const scopeLabel =
    t("chat.scope.count", { count: selectedReady.length }) +
    (selectedConnections.length > 0 ? ` ${t("connectors.scope.count", { count: selectedConnections.length })}` : "");
  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="border-t bg-background p-3 sm:p-4" data-testid="chat-composer">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-primary/30">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Không gửi khi đang gõ tiếng Việt bằng bộ gõ (IME/Telex) ở bước chọn ký tự.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          placeholder={t("chat.composer.placeholder")}
          aria-label={t("chat.composer.label")}
          data-testid="chat-input"
          className="max-h-48 min-h-10 resize-none border-0 bg-transparent px-2 py-2 text-[15px] shadow-none focus-visible:ring-0"
          disabled={disabled}
        />
        <div className="flex items-center gap-2 pt-1">
          <Popover open={scopeOpen} onOpenChange={setScopeOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-full" data-testid="scope-button" aria-label={t("chat.scope.title")}>
                {scopeLabel}
                {allowWeb && useWeb && <Globe className="size-3.5 text-primary" aria-label={t("chat.scope.web")} />}
                <ChevronDown className="size-3.5 opacity-60" aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 space-y-3 p-3" data-testid="scope-popover">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("chat.scope.title")}</h3>
                {readySources.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onSelectAll(allSelected ? [] : readySources.map((s) => s.id))}>
                    {allSelected ? t("chat.scope.clear") : t("chat.scope.all")}
                  </Button>
                )}
              </div>
              {readySources.length === 0 ? (
                <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">{t("chat.scope.noReady")}</p>
              ) : (
                <ul className="max-h-56 space-y-0.5 overflow-y-auto" aria-label={t("chat.scope.sources")}>
                  {readySources.map((s) => (
                    <li key={s.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent">
                        <Checkbox checked={selectedIds.includes(s.id)} onCheckedChange={() => onToggleSource(s.id)} aria-label={s.title} />
                        <SourceTypeIcon source={s} />
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <div className="space-y-2 border-t pt-3">
                {allowWeb && (
                  <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <Globe className="size-4 text-muted-foreground" aria-hidden />
                      {t("chat.scope.web")}
                    </span>
                    <Switch checked={useWeb} onCheckedChange={onUseWebChange} aria-label={t("chat.scope.web")} data-testid="web-toggle" />
                  </label>
                )}
                <div className="space-y-1" data-testid="scope-connections">
                  <p className="flex items-center gap-2 text-sm">
                    <Plug className="size-4 text-muted-foreground" aria-hidden />
                    {t("chat.scope.connections")}
                  </p>
                  {usableConnections.length === 0 ? (
                    <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground" data-testid="scope-connections-empty">
                      {t("connectors.scope.empty")}
                    </p>
                  ) : (
                    <ul className="max-h-40 space-y-0.5 overflow-y-auto" aria-label={t("chat.scope.connections")}>
                      {usableConnections.map((c) => (
                        <li key={c.id}>
                          <label
                            className={cn("flex items-start gap-2 rounded-md px-1.5 py-1.5 text-sm", c.supportsChat ? "cursor-pointer hover:bg-accent" : "cursor-not-allowed opacity-60")}
                            title={c.supportsChat ? undefined : t("connectors.scope.noChat")}
                          >
                            <Checkbox
                              className="mt-0.5"
                              checked={c.supportsChat && selectedConnectionIds.includes(c.id)}
                              disabled={!c.supportsChat}
                              onCheckedChange={() => onToggleConnection?.(c.id)}
                              aria-label={c.label}
                              data-testid="scope-connection"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span
                                  className={cn("size-1.5 shrink-0 rounded-full", c.status === "ready" ? "bg-emerald-500" : c.status === "error" ? "bg-destructive" : "bg-muted-foreground/50")}
                                  aria-label={t(`connectors.status.${c.status}`)}
                                />
                                <span className="truncate">{c.label}</span>
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {c.supportsChat ? (c.provider === "notebooklm-bridge" ? "NotebookLM Bridge" : "Enterprise") : t("connectors.scope.noChat")}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <div className="ml-auto flex items-center gap-2">
            {models.length > 1 ? (
              <Select value={model ?? models[0]} onValueChange={onModelChange}>
                <SelectTrigger size="sm" className="h-8 w-auto max-w-44 gap-1 rounded-full border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none" aria-label={t("chat.model.label")} data-testid="model-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {models.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              models[0] && (
                <span className="max-w-44 truncate px-2 text-xs text-muted-foreground" title={t("chat.model.label")} data-testid="model-label">
                  {models[0]}
                </span>
              )
            )}
            {streaming ? (
              <Button size="sm" variant="secondary" className="h-8 rounded-full" onClick={onStop} data-testid="stop-button">
                <Square className="fill-current" /> {t("chat.stop")}
              </Button>
            ) : (
              <Button
                size="icon"
                className={cn("size-8 rounded-full", !canSend && "opacity-50")}
                onClick={() => void submit()}
                disabled={!canSend}
                aria-label={t("chat.send")}
                data-testid="send-button"
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
      <p className="mx-auto mt-1.5 max-w-3xl px-2 text-center text-[11px] text-muted-foreground">{t("chat.composer.hint")}</p>
    </div>
  );
}
