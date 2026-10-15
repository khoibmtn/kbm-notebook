import { BookOpenText, MailX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ResendVerificationButton } from "@/components/auth/verify-email-banner";
import { AcceptInviteButton } from "@/components/invite/accept-invite-button";
import { SignOutLink } from "@/components/invite/sign-out-link";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import type { MessageKey } from "@/lib/i18n";
import { getSession } from "@/server/auth/session";
import { emailVerificationRequired } from "@/server/env";
import { getInviteByToken, isInviteExpired } from "@/server/notebooks/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("invite.title") };
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getT();
  const next = `/invite/${token}`;

  let row: Awaited<ReturnType<typeof getInviteByToken>> | null = null;
  try {
    row = await getInviteByToken(token);
  } catch {
    row = null;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-lg font-semibold">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BookOpenText className="size-5" />
        </span>
        {t("app.name")}
      </div>
      <Card className="w-full max-w-md">
        {!row ? (
          <CardContent>
            <EmptyState icon={MailX} title={t("invite.invalid.title")} description={t("invite.invalid.description")} action={
              <Button asChild variant="outline"><Link href="/">{t("nav.backToDashboard")}</Link></Button>
            } />
          </CardContent>
        ) : (
          await InviteBody({ row, next })
        )}
      </Card>
    </main>
  );
}

async function InviteBody({ row, next }: { row: NonNullable<Awaited<ReturnType<typeof getInviteByToken>>>; next: string }) {
  const t = await getT();
  const session = await getSession();
  const { invite } = row;
  const expired = isInviteExpired(invite);
  const used = invite.acceptedAt != null;
  const roleLabel = t(`role.${invite.role}` as MessageKey);

  return (
    <>
      <CardHeader>
        <CardTitle role="heading" aria-level={1} className="text-xl">
          {row.notebookEmoji ?? "📓"} {row.notebookTitle}
        </CardTitle>
        <CardDescription>
          {t("invite.description", { inviter: row.inviterName ?? t("invite.someone"), role: roleLabel })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("invite.forEmail", { email: invite.email })}</p>
        {used ? (
          <p className="text-sm text-destructive">{t("invite.used")}</p>
        ) : expired ? (
          <p className="text-sm text-destructive">{t("invite.expired")}</p>
        ) : !session ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="flex-1">
              <Link href={`/login?next=${encodeURIComponent(next)}`}>{t("auth.login.title")}</Link>
            </Button>
            <Button asChild variant="outline" className="flex-1">
              <Link href={`/register?next=${encodeURIComponent(next)}`}>{t("auth.register.title")}</Link>
            </Button>
          </div>
        ) : session.user.email.toLowerCase() === invite.email.toLowerCase() ? (
          emailVerificationRequired() && !session.user.emailVerified ? (
            <div className="space-y-3" data-testid="invite-verify-first">
              <p className="text-sm text-warning">{t("invite.verifyFirst", { email: session.user.email })}</p>
              <ResendVerificationButton email={session.user.email} callbackURL={next} />
            </div>
          ) : (
            <AcceptInviteButton token={invite.token} />
          )
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{t("invite.wrongAccount", { email: session.user.email })}</p>
            <SignOutLink next={next} />
          </div>
        )}
      </CardContent>
    </>
  );
}
