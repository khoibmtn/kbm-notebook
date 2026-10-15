import { BookOpenText, Compass, Heart, Lock, MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JoinRequestButton, type JoinState } from "@/components/community/join-request-button";
import { NotebookCover } from "@/components/shared/notebook-cover";
import { TYPE_ICONS, TYPE_NAME_KEY } from "@/components/studio/type-meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { formatRelative } from "@/lib/format";
import { getSession } from "@/server/auth/session";
import { memberRoleOf } from "@/server/community/explore";
import { getMyJoinRequestStatus } from "@/server/community/join-requests";
import { getPublicNotebookBySlug } from "@/server/community/public-notebooks";

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const nb = await getPublicNotebookBySlug(slug);
  return { title: nb?.title ?? "KBM Notebook", description: nb?.description ?? undefined };
}

/**
 * `/p/[slug]` — trang công khai của sổ tay (không cần đăng nhập). CHỈ hiển thị tiêu đề, mô tả, emoji và artifact
 * công khai; nguồn, ghi chú, hội thoại, tin nhắn và danh sách thành viên không bao giờ được truy vấn ở đây.
 */
export default async function PublicNotebookPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const t = await getT();
  const locale = await getLocale();
  const session = await getSession().catch(() => null);
  const nb = await getPublicNotebookBySlug(slug);

  const header = (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4 sm:px-6">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BookOpenText className="size-4" aria-hidden />
        </span>
        <span className="hidden sm:inline">{t("app.name")}</span>
      </Link>
      {session ? (
        <Button asChild variant="outline" size="sm">
          <Link href="/explore">
            <Compass /> {t("nav.explore")}
          </Link>
        </Button>
      ) : (
        <Button asChild variant="outline" size="sm">
          <Link href="/login">{t("auth.login.submit")}</Link>
        </Button>
      )}
    </header>
  );

  if (!nb) notFound();

  let joinState: JoinState = "guest";
  if (session) {
    const role = await memberRoleOf(session.user.id, nb.id);
    if (role) joinState = "member";
    else joinState = (await getMyJoinRequestStatus(nb.id, session.user.id)) ?? "none";
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30" data-testid="public-notebook">
      {header}
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-4 py-6 sm:px-6">
        <section className="overflow-hidden rounded-xl border bg-background">
          <NotebookCover color={nb.coverColor} emoji={nb.emoji} className="h-24 px-6 pb-3 text-4xl" />
          <div className="space-y-4 p-6">
            <div className="space-y-1">
              <h1 className="break-words text-2xl font-semibold" data-testid="public-title">
                {nb.title}
              </h1>
              <p className="text-sm text-muted-foreground">{t("community.card.owner", { name: nb.ownerName })}</p>
              {nb.description && <p className="whitespace-pre-wrap pt-2 text-sm">{nb.description}</p>}
            </div>
            <JoinRequestButton notebookId={nb.id} slug={nb.slug} initial={joinState} />
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5" aria-hidden /> {t("community.public.privacyNote")}
            </p>
          </div>
        </section>

        <section className="space-y-3" aria-labelledby="pub-artifacts">
          <h2 id="pub-artifacts" className="text-base font-semibold">
            {t("community.public.artifacts")}
          </h2>
          {nb.artifacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("community.public.noArtifacts")}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="public-artifacts">
              {nb.artifacts.map((a) => {
                const Icon = TYPE_ICONS[a.type];
                return (
                  <li key={a.id}>
                    <Link href={`/a/${a.id}`} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Card className="h-full gap-2 p-4 transition-shadow hover:shadow-md">
                        <div className="flex items-start gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <h3 className="line-clamp-2 min-w-0 flex-1 font-medium leading-snug">{a.title}</h3>
                          <Badge variant="secondary">{t(TYPE_NAME_KEY[a.type])}</Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <time dateTime={a.createdAt}>{formatRelative(a.createdAt, locale)}</time>
                          <span className="ml-auto flex items-center gap-1" aria-label={t("community.card.likes", { count: a.likeCount })}>
                            <Heart className="size-3.5" aria-hidden /> {a.likeCount}
                          </span>
                          <span className="flex items-center gap-1" aria-label={t("community.card.comments", { count: a.commentCount })}>
                            <MessageSquare className="size-3.5" aria-hidden /> {a.commentCount}
                          </span>
                        </div>
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
