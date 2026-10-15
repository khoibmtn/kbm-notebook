"use client";
import { BookOpenText } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ArtifactDetailDto } from "@/lib/artifacts/meta";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import { ArtifactBody } from "./artifact-body";
import { TYPE_ICONS, TYPE_NAME_KEY } from "./type-meta";

type Props = {
  artifact: Pick<ArtifactDetailDto, "id" | "type" | "title" | "content" | "createdByName" | "updatedAt">;
  signedIn: boolean;
  /** Có → chip trích dẫn mở Source viewer (người xem là thành viên sổ tay); không có → chỉ hiện tooltip. */
  notebookId?: string;
};

/** Trang chỉ đọc cho artifact chia sẻ (`/s/[token]`, `/a/[artifactId]`): không có chỉnh sửa, không lộ nguồn gốc. */
export function SharedArtifactView({ artifact, signedIn, notebookId }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const Icon = TYPE_ICONS[artifact.type];
  return (
    <div className="flex min-h-screen flex-col bg-muted/30" data-testid="shared-artifact">
      <header className="flex items-center gap-3 border-b bg-background px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BookOpenText className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-base font-semibold">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate" data-testid="shared-title">
              {artifact.title}
            </span>
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {t(TYPE_NAME_KEY[artifact.type])}
            {artifact.createdByName ? ` · ${t("studio.shared.by", { name: artifact.createdByName })}` : ""} · {formatRelative(artifact.updatedAt, locale)} · {t("studio.shared.readOnly")}
          </p>
        </div>
        {!signedIn && (
          <Button asChild size="sm" variant="outline">
            <Link href="/login">{t("auth.login.submit")}</Link>
          </Button>
        )}
      </header>
      <main className="flex-1 p-4 sm:p-6">
        {artifact.content ? (
          <ArtifactBody artifactId={artifact.id} type={artifact.type} content={artifact.content} readOnly notebookId={notebookId} />
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">{t("studio.noContent")}</p>
        )}
      </main>
      <footer className="border-t bg-background px-4 py-3 text-center text-xs text-muted-foreground">{t("studio.shared.footer")}</footer>
    </div>
  );
}
