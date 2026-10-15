"use client";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Eye, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { extractMarkdownCitations } from "@/lib/artifacts/citations";
import { newItemId, type QuizContent, type QuizQuestion } from "@/lib/artifacts/content";
import { useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import { MarkdownView } from "@/components/shared/markdown-view";
import { CitationChip, CitationList } from "./citation-chip";
import { NativeSelect } from "./native-select";
import { SourcesFooter } from "./sources-footer";

type Props = {
  content: QuizContent;
  onChange?: (c: QuizContent) => void;
  readOnly?: boolean;
  notebookId?: string;
};

/* -------------------------------------------------------------------------- */
/* Người chơi                                                                  */
/* -------------------------------------------------------------------------- */

function isCorrect(q: QuizQuestion, answer: string | undefined, selfGrade: boolean | undefined): boolean | null {
  if (answer === undefined || answer === "") return null;
  if (q.type === "short") return selfGrade ?? null;
  return answer === q.answer;
}

function QuizPlayer({ content, notebookId }: { content: QuizContent; notebookId?: string }) {
  const t = useT();
  const qs = content.questions;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [grades, setGrades] = useState<Record<string, boolean>>({});
  const [finished, setFinished] = useState(false);

  const score = useMemo(() => qs.filter((q) => revealed[q.id] && isCorrect(q, answers[q.id], grades[q.id]) === true).length, [qs, revealed, answers, grades]);
  const answeredCount = qs.filter((q) => revealed[q.id]).length;

  const restart = () => {
    setAnswers({});
    setRevealed({});
    setGrades({});
    setFinished(false);
    setIndex(0);
  };

  if (finished) {
    const wrong = qs.filter((q) => isCorrect(q, answers[q.id], grades[q.id]) !== true);
    return (
      <div className="space-y-4" data-testid="quiz-summary">
        <div className="rounded-xl border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">{t("studio.quiz.yourScore")}</p>
          <p className="mt-1 text-4xl font-semibold" data-testid="quiz-score">
            {score}/{qs.length}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t("studio.quiz.percent", { percent: Math.round((score / qs.length) * 100) })}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={restart} variant="outline">
              <RotateCcw /> {t("studio.quiz.restart")}
            </Button>
            <Button onClick={() => { setFinished(false); setIndex(0); }}>{t("studio.quiz.review")}</Button>
          </div>
        </div>
        {wrong.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("studio.quiz.wrongList")}</h3>
            <ul className="space-y-2">
              {wrong.map((q) => (
                <li key={q.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{q.stem}</p>
                  <p className="mt-1 text-muted-foreground">
                    {t("studio.export.answer")}: {q.type === "tf" ? (q.answer === "true" ? t("studio.quiz.true") : t("studio.quiz.false")) : q.type === "mcq" ? `${q.answer}. ${q.options?.find((o) => o.key === q.answer)?.text ?? ""}` : q.answer}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
        <SourcesFooter evidence={content.evidence} notebookId={notebookId} />
      </div>
    );
  }

  const q = qs[index];
  const answer = answers[q.id];
  const isRevealed = Boolean(revealed[q.id]);
  const verdict = isRevealed ? isCorrect(q, answer, grades[q.id]) : null;
  const canReveal = q.type === "short" ? true : answer !== undefined;
  const optionList: Array<{ key: string; text: string }> =
    q.type === "tf" ? [{ key: "true", text: t("studio.quiz.true") }, { key: "false", text: t("studio.quiz.false") }] : (q.options ?? []);

  return (
    <div className="space-y-4" data-testid="quiz-player">
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span data-testid="quiz-progress">{t("studio.quiz.progress", { current: index + 1, total: qs.length })}</span>
        <span>{t("studio.quiz.scoreSoFar", { score, answered: answeredCount })}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full bg-primary transition-all" style={{ width: `${((index + 1) / qs.length) * 100}%` }} />
      </div>

      <div className="rounded-xl border bg-card p-5">
        <p className="text-base font-medium leading-relaxed" data-testid="quiz-stem">
          {q.stem}
        </p>
        <fieldset className="mt-4 space-y-2" disabled={isRevealed && q.type !== "short"}>
          <legend className="sr-only">{q.stem}</legend>
          {q.type === "short" ? (
            <Textarea
              value={answer ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              placeholder={t("studio.quiz.shortPlaceholder")}
              disabled={isRevealed}
              aria-label={t("studio.quiz.shortPlaceholder")}
            />
          ) : (
            optionList.map((o) => {
              const chosen = answer === o.key;
              const right = isRevealed && o.key === q.answer;
              const wrong = isRevealed && chosen && o.key !== q.answer;
              return (
                <label
                  key={o.key}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-accent/50",
                    chosen && !isRevealed && "border-primary bg-primary/5",
                    right && "border-success bg-success/10",
                    wrong && "border-destructive bg-destructive/10",
                  )}
                  data-testid={`quiz-option-${o.key}`}
                >
                  <input type="radio" name={`q-${q.id}`} className="mt-1" checked={chosen} onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.key }))} />
                  {q.type === "mcq" && <span className="font-medium">{o.key}.</span>}
                  <span className="flex-1">{o.text}</span>
                  {right && <Check className="size-4 text-success" aria-label={t("studio.quiz.correct")} />}
                  {wrong && <X className="size-4 text-destructive" aria-label={t("studio.quiz.incorrect")} />}
                </label>
              );
            })
          )}
        </fieldset>

        {isRevealed && (
          <div className="mt-4 rounded-lg bg-muted/60 p-3 text-sm" data-testid="quiz-explanation" role="status">
            {q.type === "short" && (
              <div className="mb-2 space-y-2">
                <p>
                  <span className="font-medium">{t("studio.quiz.sampleAnswer")}:</span> {q.answer}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{t("studio.quiz.selfGrade")}</span>
                  <Button size="sm" variant={grades[q.id] === true ? "default" : "outline"} onClick={() => setGrades((g) => ({ ...g, [q.id]: true }))}>
                    {t("studio.quiz.iWasRight")}
                  </Button>
                  <Button size="sm" variant={grades[q.id] === false ? "destructive" : "outline"} onClick={() => setGrades((g) => ({ ...g, [q.id]: false }))}>
                    {t("studio.quiz.iWasWrong")}
                  </Button>
                </div>
              </div>
            )}
            {q.type !== "short" && (
              <p className={cn("mb-1 font-medium", verdict ? "text-success" : "text-destructive")}>{verdict ? t("studio.quiz.correct") : t("studio.quiz.incorrect")}</p>
            )}
            {q.explanation && (
              <MarkdownView
                markdown={q.explanation}
                className="text-sm leading-relaxed"
                renderCitation={(n) => <CitationChip n={n} evidence={content.evidence} notebookId={notebookId} />}
              />
            )}
            <div className="mt-1">
              <CitationList
                citations={q.citations?.filter((n) => !extractMarkdownCitations(q.explanation).includes(n))}
                evidence={content.evidence}
                notebookId={notebookId}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
          <ChevronLeft /> {t("studio.quiz.prev")}
        </Button>
        {!isRevealed ? (
          <Button onClick={() => setRevealed((r) => ({ ...r, [q.id]: true }))} disabled={!canReveal} data-testid="quiz-check">
            <Eye /> {q.type === "short" ? t("studio.quiz.showAnswer") : t("studio.quiz.check")}
          </Button>
        ) : index < qs.length - 1 ? (
          <Button onClick={() => setIndex((i) => i + 1)} data-testid="quiz-next">
            {t("studio.quiz.next")} <ChevronRight />
          </Button>
        ) : (
          <Button onClick={() => setFinished(true)} data-testid="quiz-finish">
            {t("studio.quiz.finish")}
          </Button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Trình chỉnh sửa                                                             */
/* -------------------------------------------------------------------------- */

const LETTERS = "ABCDEFGH";

function blankQuestion(type: QuizQuestion["type"]): QuizQuestion {
  if (type === "mcq") {
    return { id: newItemId("q"), type, stem: "", options: [{ key: "A", text: "" }, { key: "B", text: "" }], answer: "A", explanation: "", difficulty: "medium" };
  }
  if (type === "tf") return { id: newItemId("q"), type, stem: "", answer: "true", explanation: "", difficulty: "medium" };
  return { id: newItemId("q"), type, stem: "", answer: "", explanation: "", difficulty: "medium" };
}

function QuestionEditor({
  q,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  q: QuizQuestion;
  index: number;
  total: number;
  onChange: (q: QuizQuestion) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const t = useT();
  const setType = (type: QuizQuestion["type"]) => {
    if (type === q.type) return;
    const base = blankQuestion(type);
    onChange({ ...base, id: q.id, stem: q.stem, explanation: q.explanation, difficulty: q.difficulty, citations: q.citations });
  };
  const options = q.options ?? [];
  const setOptions = (next: Array<{ key: string; text: string }>) => {
    const reKeyed = next.map((o, i) => ({ ...o, key: LETTERS[i] }));
    const oldIdx = options.findIndex((o) => o.key === q.answer);
    const answerIdx = Math.min(Math.max(oldIdx, 0), reKeyed.length - 1);
    onChange({ ...q, options: reKeyed, answer: reKeyed[answerIdx]?.key ?? "A" });
  };
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4" data-testid="quiz-question-editor">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{t("studio.quiz.questionN", { n: index + 1 })}</span>
        <NativeSelect value={q.type} onChange={(e) => setType(e.target.value as QuizQuestion["type"])} aria-label={t("studio.quiz.type")}>
          <option value="mcq">{t("studio.quiz.type.mcq")}</option>
          <option value="tf">{t("studio.quiz.type.tf")}</option>
          <option value="short">{t("studio.quiz.type.short")}</option>
        </NativeSelect>
        <NativeSelect value={q.difficulty} onChange={(e) => onChange({ ...q, difficulty: e.target.value as QuizQuestion["difficulty"] })} aria-label={t("studio.options.difficulty")}>
          <option value="easy">{t("studio.options.difficulty.easy")}</option>
          <option value="medium">{t("studio.options.difficulty.medium")}</option>
          <option value="hard">{t("studio.options.difficulty.hard")}</option>
        </NativeSelect>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" onClick={() => onMove(-1)} disabled={index === 0} aria-label={t("studio.edit.moveUp")}>
            <ArrowUp />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => onMove(1)} disabled={index === total - 1} aria-label={t("studio.edit.moveDown")}>
            <ArrowDown />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label={t("studio.quiz.removeQuestion")}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <Textarea value={q.stem} onChange={(e) => onChange({ ...q, stem: e.target.value })} placeholder={t("studio.quiz.stemPlaceholder")} aria-label={t("studio.quiz.stemPlaceholder")} data-testid="quiz-stem-input" />

      {q.type === "mcq" && (
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={o.key} className="flex items-center gap-2">
              <input type="radio" name={`ans-${q.id}`} checked={q.answer === o.key} onChange={() => onChange({ ...q, answer: o.key })} aria-label={t("studio.quiz.markCorrect", { key: o.key })} />
              <span className="w-5 text-sm font-medium">{o.key}.</span>
              <Input value={o.text} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} aria-label={t("studio.quiz.optionN", { key: o.key })} />
              <Button size="icon-sm" variant="ghost" disabled={options.length <= 2} onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label={t("studio.quiz.removeOption", { key: o.key })}>
                <X />
              </Button>
            </div>
          ))}
          {options.length < LETTERS.length && (
            <Button size="sm" variant="outline" onClick={() => setOptions([...options, { key: LETTERS[options.length], text: "" }])}>
              <Plus /> {t("studio.quiz.addOption")}
            </Button>
          )}
        </div>
      )}
      {q.type === "tf" && (
        <NativeSelect value={q.answer} onChange={(e) => onChange({ ...q, answer: e.target.value })} aria-label={t("studio.export.answer")}>
          <option value="true">{t("studio.quiz.true")}</option>
          <option value="false">{t("studio.quiz.false")}</option>
        </NativeSelect>
      )}
      {q.type === "short" && <Input value={q.answer} onChange={(e) => onChange({ ...q, answer: e.target.value })} placeholder={t("studio.quiz.sampleAnswer")} aria-label={t("studio.quiz.sampleAnswer")} />}
      <Textarea value={q.explanation} onChange={(e) => onChange({ ...q, explanation: e.target.value })} placeholder={t("studio.quiz.explanationPlaceholder")} aria-label={t("studio.export.explanation")} />
    </div>
  );
}

function QuizEditor({ content, onChange }: { content: QuizContent; onChange: (c: QuizContent) => void }) {
  const t = useT();
  const set = (questions: QuizQuestion[]) => onChange({ ...content, questions });
  const move = (i: number, dir: -1 | 1) => {
    const next = [...content.questions];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  return (
    <div className="space-y-3" data-testid="quiz-editor">
      {content.questions.map((q, i) => (
        <QuestionEditor
          key={q.id}
          q={q}
          index={i}
          total={content.questions.length}
          onChange={(nq) => set(content.questions.map((x) => (x.id === q.id ? nq : x)))}
          onRemove={() => set(content.questions.filter((x) => x.id !== q.id))}
          onMove={(d) => move(i, d)}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => set([...content.questions, blankQuestion("mcq")])} data-testid="quiz-add-question">
          <Plus /> {t("studio.quiz.addQuestion")}
        </Button>
        <Button variant="outline" onClick={() => set([...content.questions, blankQuestion("tf")])}>
          <Plus /> {t("studio.quiz.addTf")}
        </Button>
        <Button variant="outline" onClick={() => set([...content.questions, blankQuestion("short")])}>
          <Plus /> {t("studio.quiz.addShort")}
        </Button>
      </div>
    </div>
  );
}

/** Bài kiểm tra: tab "Làm bài" (người chơi) và "Chỉnh sửa" (cho người có quyền sửa). */
export function QuizView({ content, onChange, readOnly, notebookId }: Props) {
  const t = useT();
  const [mode, setMode] = useState<"play" | "edit">("play");
  const canEdit = !readOnly && Boolean(onChange);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {canEdit && (
        <div className="inline-flex rounded-lg border p-0.5" role="tablist" aria-label={t("studio.quiz.mode")}>
          {(["play", "edit"] as const).map((m) => (
            <Button key={m} role="tab" aria-selected={mode === m} size="sm" variant={mode === m ? "secondary" : "ghost"} onClick={() => setMode(m)} data-testid={`quiz-mode-${m}`}>
              {t(m === "play" ? "studio.quiz.modePlay" : "studio.quiz.modeEdit")}
            </Button>
          ))}
        </div>
      )}
      {mode === "play" || !canEdit ? <QuizPlayer key={JSON.stringify(content.questions.map((q) => q.id))} content={content} notebookId={notebookId} /> : <QuizEditor content={content} onChange={onChange!} />}
    </div>
  );
}
