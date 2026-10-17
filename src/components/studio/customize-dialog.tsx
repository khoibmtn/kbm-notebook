"use client";
import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import type { ArtifactOptions, ArtifactTypeName } from "@/lib/artifacts/meta";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n-client";
import { NativeSelect } from "./native-select";
import { TYPE_ICONS, TYPE_NAME_KEY } from "./type-meta";

type EffectivePrompt = { system: string; user: string; options: Record<string, unknown> };
type PromptsResponse = { effective: Record<string, EffectivePrompt> };

let promptsCache: Promise<PromptsResponse> | null = null;
/** Prompt hiệu lực (mặc định ⊕ ghi đè trong Cài đặt) — tải một lần, làm mới khi mở lại sau lỗi. */
function loadPrompts(force = false): Promise<PromptsResponse> {
  if (!promptsCache || force) {
    promptsCache = api<PromptsResponse>("/api/settings/prompts").catch((e) => {
      promptsCache = null;
      throw e;
    });
  }
  return promptsCache;
}

type SelectField = { kind: "select"; key: keyof ArtifactOptions; label: MessageKey; choices: Array<{ value: string; label?: MessageKey; text?: string }> };
type NumberField = { kind: "number"; key: keyof ArtifactOptions; label: MessageKey; min: number; max: number };
type TextField = { kind: "text"; key: keyof ArtifactOptions; label: MessageKey; placeholder?: MessageKey };
type SwitchField = { kind: "switch"; key: keyof ArtifactOptions; label: MessageKey };
type MultiField = { kind: "multi"; key: keyof ArtifactOptions; label: MessageKey; choices: Array<{ value: string; label: MessageKey }> };
type Field = SelectField | NumberField | TextField | SwitchField | MultiField;

const LENGTH: SelectField = {
  kind: "select",
  key: "length",
  label: "studio.options.length",
  choices: [
    { value: "short", label: "studio.options.length.short" },
    { value: "medium", label: "studio.options.length.medium" },
    { value: "long", label: "studio.options.length.long" },
  ],
};

const LANGUAGE: SelectField = {
  kind: "select",
  key: "language",
  label: "studio.options.language",
  choices: [
    { value: "Tiếng Việt", label: "studio.options.language.vi" },
    { value: "English", label: "studio.options.language.en" },
  ],
};

const FIELDS: Record<ArtifactTypeName, Field[]> = {
  note: [LENGTH],
  report: [
    {
      kind: "select",
      key: "format",
      label: "studio.options.format",
      choices: [
        { value: "briefing", label: "studio.options.format.briefing" },
        { value: "study_guide", label: "studio.options.format.study_guide" },
        { value: "faq", label: "studio.options.format.faq" },
        { value: "timeline", label: "studio.options.format.timeline" },
      ],
    },
    LENGTH,
  ],
  study_guide: [LENGTH],
  faq: [{ kind: "number", key: "count", label: "studio.options.countFaq", min: 3, max: 50 }],
  timeline: [],
  quiz: [
    { kind: "number", key: "count", label: "studio.options.countQuiz", min: 1, max: 50 },
    {
      kind: "select",
      key: "difficulty",
      label: "studio.options.difficulty",
      choices: [
        { value: "easy", label: "studio.options.difficulty.easy" },
        { value: "medium", label: "studio.options.difficulty.medium" },
        { value: "hard", label: "studio.options.difficulty.hard" },
      ],
    },
    {
      kind: "multi",
      key: "questionTypes",
      label: "studio.options.questionTypes",
      choices: [
        { value: "mcq", label: "studio.quiz.type.mcq" },
        { value: "tf", label: "studio.quiz.type.tf" },
        { value: "short", label: "studio.quiz.type.short" },
      ],
    },
  ],
  flashcards: [{ kind: "number", key: "count", label: "studio.options.countCards", min: 1, max: 100 }],
  mindmap: [{ kind: "number", key: "depth", label: "studio.options.depth", min: 2, max: 5 }],
  data_table: [{ kind: "text", key: "columnsHint", label: "studio.options.columnsHint", placeholder: "studio.options.columnsHint.placeholder" }],
  slide_deck: [
    {
      kind: "select",
      key: "slideCount",
      label: "studio.options.slideCount",
      choices: [{ value: "auto", label: "studio.options.slideCount.auto" }, ...[6, 8, 10, 12, 15, 20, 25, 30, 40].map((n) => ({ value: String(n), text: String(n) }))],
    },
    {
      kind: "select",
      key: "style",
      label: "studio.options.style",
      choices: [
        { value: "detailed", label: "studio.options.style.detailed" },
        { value: "concise", label: "studio.options.style.concise" },
      ],
    },
    { kind: "text", key: "audience", label: "studio.options.audience", placeholder: "studio.options.audience.placeholder" },
    { kind: "switch", key: "includeImages", label: "studio.options.includeImages" },
  ],
  infographic: [
    {
      kind: "select",
      key: "orientation",
      label: "studio.options.orientation",
      choices: [
        { value: "portrait", label: "studio.options.orientation.portrait" },
        { value: "landscape", label: "studio.options.orientation.landscape" },
      ],
    },
    {
      kind: "select",
      key: "detailLevel",
      label: "studio.options.detailLevel",
      choices: [
        { value: "low", label: "studio.options.detailLevel.low" },
        { value: "medium", label: "studio.options.detailLevel.medium" },
        { value: "high", label: "studio.options.detailLevel.high" },
      ],
    },
  ],
};

/** Giá trị khởi tạo của form: mặc định tích hợp, ưu tiên tuỳ chọn hiệu lực hợp lệ từ Cài đặt. */
export function defaultOptionsFor(type: ArtifactTypeName, effective?: Record<string, unknown>): ArtifactOptions {
  const base: ArtifactOptions = { language: "Tiếng Việt" };
  switch (type) {
    case "report":
      Object.assign(base, { format: "briefing", length: "medium" });
      break;
    case "study_guide":
    case "note":
      Object.assign(base, { length: "medium" });
      break;
    case "faq":
      Object.assign(base, { count: 12 });
      break;
    case "quiz":
      Object.assign(base, { count: 10, difficulty: "medium", questionTypes: ["mcq"] });
      break;
    case "flashcards":
      Object.assign(base, { count: 20 });
      break;
    case "mindmap":
      Object.assign(base, { depth: 3 });
      break;
    case "slide_deck":
      Object.assign(base, { slideCount: "auto", style: "concise", includeImages: false });
      break;
    case "infographic":
      Object.assign(base, { orientation: "portrait", detailLevel: "medium" });
      break;
    default:
      break;
  }
  // Giá trị số hợp lệ trong prompt hiệu lực (vd. count: 12) được ưu tiên.
  for (const f of FIELDS[type]) {
    const v = effective?.[f.key];
    if (f.kind === "number" && typeof v === "number" && v >= f.min && v <= f.max) (base as Record<string, unknown>)[f.key] = v;
    if (f.kind === "select" && typeof v === "string" && f.choices.some((c) => c.value === v)) (base as Record<string, unknown>)[f.key] = v;
  }
  return base;
}

export type CustomizeResult = { customPrompt?: string; options: ArtifactOptions; model?: string };

type Props = {
  type: ArtifactTypeName;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Số nguồn trong phạm vi hiện tại. */
  scopeCount: number;
  creating?: boolean;
  onSubmit: (r: CustomizeResult) => void | Promise<void>;
};

function FieldInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  const t = useT();
  const id = `opt-${String(field.key)}`;
  switch (field.kind) {
    case "select":
      return (
        <NativeSelect id={id} value={String(value ?? "")} onChange={(e) => onChange(field.key === "slideCount" && e.target.value !== "auto" ? Number(e.target.value) : e.target.value)} className="w-full">
          {field.choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label ? t(c.label) : c.text}
            </option>
          ))}
        </NativeSelect>
      );
    case "number":
      return (
        <Input
          id={id}
          type="number"
          min={field.min}
          max={field.max}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Math.max(field.min, Math.min(field.max, Math.round(Number(e.target.value)))))}
        />
      );
    case "text":
      return <Input id={id} value={typeof value === "string" ? value : ""} placeholder={field.placeholder ? t(field.placeholder) : undefined} onChange={(e) => onChange(e.target.value || undefined)} />;
    case "switch":
      return <Switch id={id} checked={Boolean(value)} onCheckedChange={onChange} />;
    case "multi": {
      const cur = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-3">
          {field.choices.map((c) => (
            <label key={c.value} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={cur.includes(c.value)}
                onChange={(e) => {
                  const next = e.target.checked ? [...cur, c.value] : cur.filter((x) => x !== c.value);
                  onChange(next.length ? next : cur); // luôn giữ ít nhất một loại
                }}
              />
              {t(c.label)}
            </label>
          ))}
        </div>
      );
    }
  }
}

/** Hộp "Tuỳ chỉnh": prompt hiệu lực (chỉ đọc), prompt riêng, tuỳ chọn theo loại, phạm vi nguồn, model. */
export function CustomizeDialog({ type, open, onOpenChange, scopeCount, creating, onSubmit }: Props) {
  const t = useT();
  const Icon = TYPE_ICONS[type];
  const [prompt, setPrompt] = useState<EffectivePrompt | null>(null);
  const [promptError, setPromptError] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [options, setOptions] = useState<ArtifactOptions>(() => defaultOptionsFor(type));
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadPrompts()
      .then((res) => {
        if (cancelled) return;
        const eff = res.effective[type] ?? null;
        setPrompt(eff);
        setPromptError(false);
        setOptions(defaultOptionsFor(type, eff?.options));
      })
      .catch(() => {
        if (!cancelled) setPromptError(true);
      });
    api<{ settings: { defaultArtifactModel: string | null; fallbackModels: { chat: string; artifact: string } } }>("/api/settings/ai")
      .then((res) => {
        if (cancelled) return;
        const list = [res.settings.defaultArtifactModel, res.settings.fallbackModels.artifact, res.settings.fallbackModels.chat].filter((m): m is string => Boolean(m));
        setModels([...new Set(list)]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, type]);

  const fields = useMemo(() => [LANGUAGE, ...FIELDS[type]], [type]);
  const setOpt = (key: keyof ArtifactOptions, v: unknown) => setOptions((o) => ({ ...o, [key]: v }));

  const submit = () => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(options)) if (v !== undefined && v !== "") clean[k] = v;
    void onSubmit({ customPrompt: customPrompt.trim() || undefined, options: clean as ArtifactOptions, model: model.trim() || undefined });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-testid="customize-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-5" aria-hidden /> {t("studio.customize.title", { name: t(TYPE_NAME_KEY[type]) })}
          </DialogTitle>
          <DialogDescription>{t("studio.customize.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30">
            <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium" onClick={() => setShowPrompt((v) => !v)} aria-expanded={showPrompt} data-testid="effective-prompt-toggle">
              {t("studio.customize.effectivePrompt")}
              <ChevronDown className={`size-4 transition-transform ${showPrompt ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {showPrompt && (
              <div className="space-y-2 border-t px-3 py-2 text-xs" data-testid="effective-prompt">
                {promptError ? (
                  <p className="text-destructive">{t("studio.customize.promptError")}</p>
                ) : !prompt ? (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> {t("common.loading")}
                  </p>
                ) : (
                  <>
                    <div>
                      <p className="mb-0.5 font-medium text-muted-foreground">{t("studio.customize.system")}</p>
                      <pre className="whitespace-pre-wrap rounded bg-background p-2">{prompt.system}</pre>
                    </div>
                    <div>
                      <p className="mb-0.5 font-medium text-muted-foreground">{t("studio.customize.userTemplate")}</p>
                      <pre className="whitespace-pre-wrap rounded bg-background p-2">{prompt.user}</pre>
                    </div>
                    <p className="text-muted-foreground">{t("studio.customize.editInSettings")}</p>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="custom-prompt">{t("studio.customize.customPrompt")}</Label>
            <Textarea id="custom-prompt" value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder={t("studio.customize.customPromptPlaceholder")} maxLength={8000} className="min-h-24" data-testid="custom-prompt" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={String(f.key)} className={`space-y-1.5 ${f.kind === "multi" ? "sm:col-span-2" : ""}`}>
                <Label htmlFor={`opt-${String(f.key)}`}>{t(f.label)}</Label>
                <FieldInput field={f} value={(options as Record<string, unknown>)[f.key]} onChange={(v) => setOpt(f.key, v)} />
              </div>
            ))}
          </div>

          <div className="rounded-lg border px-3 py-2 text-sm" data-testid="customize-scope">
            <span className="font-medium">{t("studio.customize.scope")}: </span>
            {t("studio.scope.count", { count: scopeCount })}
            <p className="text-xs text-muted-foreground">{t("studio.customize.scopeHint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="artifact-model">{t("studio.customize.model")}</Label>
            <Input id="artifact-model" list="artifact-model-list" value={model} onChange={(e) => setModel(e.target.value)} placeholder={t("studio.customize.modelPlaceholder")} />
            <datalist id="artifact-model-list">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={creating || scopeCount === 0} data-testid="customize-create">
            {creating && <Loader2 className="animate-spin" />} {t("studio.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
