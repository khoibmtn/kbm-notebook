"use client";
import { Heart, Loader2, MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RichText } from "@/components/team-chat/rich-text";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import type { CommentDto, SocialSummaryDto } from "@/lib/community";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

type Props = {
  artifactId: string;
  /** Người xem đã đăng nhập (được thích/bình luận). */
  meId: string | null;
  /** Token liên kết chia sẻ — để khách xem được số liệu của artifact `link`. */
  shareToken?: string;
  /** Đường dẫn quay lại sau đăng nhập. */
  loginNext?: string;
  className?: string;
};

/** Thích + bình luận (markdown-lite) cho artifact công khai / chia sẻ. */
export function ArtifactSocial({ artifactId, meId, shareToken, loginNext, className }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const qs = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
  const base = `/api/artifacts/${artifactId}`;

  const [summary, setSummary] = useState<SocialSummaryDto | null>(null);
  const [comments, setComments] = useState<CommentDto[] | null>(null);
  const [error, setError] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<SocialSummaryDto>(`${base}/like${qs}`), api<{ comments: CommentDto[] }>(`${base}/comments${qs}`)])
      .then(([s, c]) => {
        if (cancelled) return;
        setSummary(s);
        setComments(c.comments);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [base, qs]);

  const toggleLike = useCallback(async () => {
    if (!summary || !meId || likeBusy) return;
    setLikeBusy(true);
    const wasLiked = summary.liked;
    // Cập nhật lạc quan, hoàn lại nếu lỗi.
    setSummary({ ...summary, liked: !wasLiked, likeCount: summary.likeCount + (wasLiked ? -1 : 1) });
    try {
      const next = await api<SocialSummaryDto>(`${base}/like`, { method: wasLiked ? "DELETE" : "POST" });
      setSummary(next);
    } catch (e) {
      setSummary(summary);
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setLikeBusy(false);
    }
  }, [base, likeBusy, meId, summary, t]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      const { comment } = await api<{ comment: CommentDto }>(`${base}/comments`, { method: "POST", json: { body } });
      setComments((cs) => [...(cs ?? []), comment]);
      setSummary((s) => (s ? { ...s, commentCount: s.commentCount + 1 } : s));
      setDraft("");
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    } finally {
      setPosting(false);
    }
  }

  async function remove(c: CommentDto) {
    if (!window.confirm(t("community.comments.deleteConfirm"))) return;
    try {
      await api(`${base}/comments/${c.id}`, { method: "DELETE" });
      setComments((cs) => (cs ?? []).filter((x) => x.id !== c.id));
      setSummary((s) => (s ? { ...s, commentCount: Math.max(0, s.commentCount - 1) } : s));
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    }
  }

  if (error) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{t("community.comments.loadError")}</p>;
  }
  if (!summary || !comments) {
    return (
      <div className={cn("space-y-3", className)} aria-busy>
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const loginHref = `/login?next=${encodeURIComponent(loginNext ?? `/a/${artifactId}`)}`;
  return (
    <section aria-label={t("community.comments.title", { count: summary.commentCount })} className={cn("space-y-4", className)} data-testid="artifact-social">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={summary.liked ? "default" : "outline"}
          size="sm"
          disabled={!meId || likeBusy}
          onClick={() => void toggleLike()}
          aria-pressed={summary.liked}
          aria-label={t(summary.liked ? "community.unlike.aria" : "community.like.aria", { count: summary.likeCount })}
          data-testid="like-button"
        >
          <Heart className={cn(summary.liked && "fill-current")} aria-hidden />
          {summary.liked ? t("community.liked") : t("community.like")}
          <span className="tabular-nums" data-testid="like-count">
            {summary.likeCount}
          </span>
        </Button>
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <MessageSquare className="size-4" aria-hidden />
          <span data-testid="comment-count">{t("community.comments.title", { count: summary.commentCount })}</span>
        </span>
        {!meId && (
          <Link href={loginHref} className="text-sm text-primary underline-offset-4 hover:underline">
            {t("community.comments.loginPrompt")}
          </Link>
        )}
      </div>

      {meId && (
        <form onSubmit={submit} className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("community.comments.placeholder")}
            aria-label={t("community.comments.label")}
            maxLength={2000}
            rows={3}
            data-testid="comment-input"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={posting || !draft.trim()} data-testid="comment-submit">
              {posting && <Loader2 className="animate-spin" />} {t("community.comments.submit")}
            </Button>
          </div>
        </form>
      )}

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("community.comments.empty")}</p>
      ) : (
        <ul className="space-y-4" data-testid="comment-list">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3" data-testid="comment-item">
              <UserAvatar name={c.author.name} image={c.author.image} className="size-8" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium">{c.author.name}</span>
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={c.createdAt}>
                    {formatRelative(c.createdAt, locale)}
                  </time>
                  {c.canDelete && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="ml-auto text-muted-foreground"
                      aria-label={t("community.comments.delete")}
                      onClick={() => void remove(c)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
                <RichText content={c.body} meId={meId ?? ""} className="text-sm" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
