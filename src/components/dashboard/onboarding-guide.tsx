"use client";
import { Compass, FolderPlus, MessageSquareText, NotebookPen } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CreateNotebookDialog } from "@/components/dashboard/create-notebook-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n-client";

type Step = { n: number; icon: typeof NotebookPen; title: string; description: string; cta: string; next: string; testId: string };

/** Dashboard rỗng: hướng dẫn 3 bước (Tạo sổ tay → Thêm nguồn → Hỏi/Studio). Mỗi nút tạo sổ tay rồi mở đúng bước. */
export function OnboardingGuide() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState("");

  const steps: Step[] = [
    { n: 1, icon: NotebookPen, title: t("onboarding.step1.title"), description: t("onboarding.step1.description"), cta: t("dashboard.create"), next: "", testId: "onboarding-create" },
    { n: 2, icon: FolderPlus, title: t("onboarding.step2.title"), description: t("onboarding.step2.description"), cta: t("palette.action.addSource"), next: "/sources?add=1", testId: "onboarding-sources" },
    { n: 3, icon: MessageSquareText, title: t("onboarding.step3.title"), description: t("onboarding.step3.description"), cta: t("nav.studio"), next: "/studio", testId: "onboarding-studio" },
  ];

  return (
    <section className="space-y-6 rounded-xl border border-dashed p-6 sm:p-8" aria-labelledby="onboarding-title" data-testid="onboarding">
      <div className="space-y-1 text-center">
        <h2 id="onboarding-title" className="text-lg font-semibold">
          {t("onboarding.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.subtitle")}</p>
      </div>
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n}>
            <Card className="h-full gap-3 p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <s.icon className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="text-xs text-muted-foreground">{t("onboarding.step.label", { n: s.n })}</p>
                  <h3 className="font-medium">{s.title}</h3>
                </div>
              </div>
              <p className="flex-1 text-sm text-muted-foreground">{s.description}</p>
              <Button
                variant={s.n === 1 ? "default" : "outline"}
                onClick={() => {
                  setNext(s.next);
                  setOpen(true);
                }}
                data-testid={s.testId}
              >
                {s.cta}
              </Button>
            </Card>
          </li>
        ))}
      </ol>
      <p className="text-center text-sm">
        <Link href="/explore" className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline">
          <Compass className="size-4" aria-hidden /> {t("onboarding.explore")}
        </Link>
      </p>
      <CreateNotebookDialog open={open} onOpenChange={setOpen} next={next} />
    </section>
  );
}
