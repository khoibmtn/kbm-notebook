"use client";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CreateNotebookDialog } from "@/components/dashboard/create-notebook-dialog";
import { OnboardingGuide } from "@/components/dashboard/onboarding-guide";
import { RoleBadge, type RoleName } from "@/components/dashboard/role-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import { DEFAULT_COVER_COLOR } from "@/lib/notebook-colors";

export type NotebookCardData = {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  coverColor: string | null;
  role: RoleName;
  memberCount: number;
  members: { id: string; name: string; image: string | null }[];
  updatedAt: string;
};

export function NotebookGrid({ initial }: { initial: NotebookCardData[] }) {
  const t = useT();
  const { locale } = useLocale();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initial;
    return initial.filter((n) => n.title.toLowerCase().includes(q) || (n.description ?? "").toLowerCase().includes(q));
  }, [initial, query]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">{t("dashboard.heading")}</h1>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("dashboard.search")}
              aria-label={t("dashboard.search")}
              className="pl-8"
            />
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> {t("dashboard.create")}
          </Button>
        </div>
      </div>

      {initial.length === 0 ? (
        <OnboardingGuide />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title={t("dashboard.noMatch")} className="py-16" />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="notebook-list">
          {filtered.map((n) => (
            <li key={n.id}>
              <Link href={`/n/${n.id}`} className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="gap-0 overflow-hidden p-0 transition-shadow group-hover:shadow-md">
                  <div
                    className="flex h-20 items-end px-4 pb-2 text-3xl"
                    style={{ backgroundColor: n.coverColor ?? DEFAULT_COVER_COLOR }}
                  >
                    <span aria-hidden>{n.emoji ?? "📓"}</span>
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="space-y-1">
                      <h2 className="line-clamp-1 font-medium">{n.title}</h2>
                      <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">{n.description}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <RoleBadge role={n.role} />
                        <span className="text-xs text-muted-foreground">{formatRelative(n.updatedAt, locale)}</span>
                      </div>
                      <div className="flex -space-x-2">
                        {n.members.map((m) => (
                          <UserAvatar key={m.id} name={m.name} image={m.image} className="size-6 border-2 border-card" />
                        ))}
                        {n.memberCount > n.members.length && (
                          <span className="flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] text-muted-foreground">
                            +{n.memberCount - n.members.length}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateNotebookDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
