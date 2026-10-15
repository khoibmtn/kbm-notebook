"use client";
import { Globe, Link2, Loader2, Lock, LogOut, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/shared/user-avatar";
import { NativeSelect } from "@/components/studio/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import type { GroupRole, GroupSummaryDto } from "@/lib/community";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import type { Role } from "@/lib/roles";

export type GroupMemberView = { userId: string; name: string; email: string | null; image: string | null; role: GroupRole; joinedAt: string };
export type GroupNotebookView = { id: string; title: string; accessible: boolean; emoji: string | null; description: string | null; canUnlink: boolean };

type Props = {
  group: GroupSummaryDto;
  ownerName: string;
  members: GroupMemberView[];
  notebooks: GroupNotebookView[];
  meId: string;
};

const roleKey = (r: GroupRole) => `community.group.role.${r}` as const;

/** Trang nhóm `/g/[slug]`: mô tả, thành viên, sổ tay liên kết, tham gia / rời / quản lý. */
export function GroupView({ group, ownerName, members, notebooks, meId }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [pick, setPick] = useState("");
  const [adminNotebooks, setAdminNotebooks] = useState<{ id: string; title: string }[] | null>(null);
  const isMember = group.myRole != null;
  const canManage = group.myRole === "owner" || group.myRole === "admin";
  const base = `/api/groups/${group.id}`;

  useEffect(() => {
    if (!isMember) return;
    let cancelled = false;
    api<{ notebooks: { id: string; title: string; role: Role }[] }>("/api/notebooks")
      .then((res) => {
        if (cancelled) return;
        const linked = new Set(notebooks.map((n) => n.id));
        setAdminNotebooks(res.notebooks.filter((n) => (n.role === "owner" || n.role === "admin") && !linked.has(n.id)).map((n) => ({ id: n.id, title: n.title })));
      })
      .catch(() => {
        if (!cancelled) setAdminNotebooks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isMember, notebooks]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  const join = () => run(() => api(`${base}/join`, { method: "POST" }), t("community.group.joined"));
  const leave = () => {
    if (!window.confirm(t("community.group.leave.confirm"))) return;
    return run(async () => {
      await api(`${base}/members/${meId}`, { method: "DELETE" });
      router.replace(group.visibility === "private" ? "/explore?tab=groups" : `/g/${group.slug}`);
    }, t("community.group.left"));
  };
  const removeGroup = () => {
    if (!window.confirm(t("community.group.delete.confirm", { name: group.name }))) return;
    return run(async () => {
      await api(base, { method: "DELETE" });
      router.replace("/explore?tab=groups");
    }, t("community.group.deleted"));
  };
  const addMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    return run(async () => {
      await api(`${base}/members`, { method: "POST", json: { email: email.trim(), role: "member" } });
      setEmail("");
    }, t("community.group.addMember.done"));
  };
  const removeMember = (m: GroupMemberView) => {
    if (!window.confirm(t("community.group.removeMember.confirm", { name: m.name }))) return;
    return run(() => api(`${base}/members/${m.userId}`, { method: "DELETE" }));
  };
  const link = () => {
    if (!pick) return;
    return run(async () => {
      await api(`${base}/notebooks`, { method: "POST", json: { notebookId: pick } });
      setPick("");
    }, t("community.group.notebooks.linked"));
  };
  const unlink = (n: GroupNotebookView) => run(() => api(`${base}/notebooks/${n.id}`, { method: "DELETE" }), t("community.group.notebooks.unlinked"));

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link href="/explore?tab=groups" className="text-sm text-muted-foreground hover:text-foreground">
          ← {t("community.group.back")}
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold" data-testid="group-title">
              <UsersRound className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="break-words">{group.name}</span>
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {group.visibility === "private" ? <Lock className="size-3.5" aria-hidden /> : <Globe className="size-3.5" aria-hidden />}
              <span>{t(group.visibility === "private" ? "community.group.visibility.private" : "community.group.visibility.public")}</span>
              <span aria-hidden>·</span>
              <span data-testid="group-member-count">{t("community.group.members.count", { count: group.memberCount })}</span>
              <span aria-hidden>·</span>
              <span>{t("community.group.owner", { name: ownerName })}</span>
            </p>
            {group.description && <p className="max-w-2xl whitespace-pre-wrap pt-1 text-sm">{group.description}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {!isMember && group.visibility === "public" && (
              <Button onClick={() => void join()} disabled={busy} data-testid="group-join">
                {busy ? <Loader2 className="animate-spin" /> : <UserPlus />} {t("community.group.join")}
              </Button>
            )}
            {!isMember && group.visibility !== "public" && <p className="text-sm text-muted-foreground">{t("community.group.inviteOnly")}</p>}
            {!isMember && group.visibility === "public" && <p className="sr-only">{t("community.group.inviteOnly")}</p>}
            {isMember && group.myRole !== "owner" && (
              <Button variant="outline" onClick={() => void leave()} disabled={busy}>
                <LogOut /> {t("community.group.leave")}
              </Button>
            )}
            {group.myRole === "owner" && (
              <Button variant="outline" className="text-destructive" onClick={() => void removeGroup()} disabled={busy}>
                <Trash2 /> {t("community.group.delete")}
              </Button>
            )}
          </div>
        </div>
      </div>

      <section className="space-y-3" aria-labelledby="g-notebooks">
        <h2 id="g-notebooks" className="text-base font-semibold">
          {t("community.group.notebooks")}
        </h2>
        {notebooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("community.group.notebooks.empty")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="group-notebooks">
            {notebooks.map((n) => (
              <li key={n.id}>
                <Card className="h-full gap-1 p-4">
                  <div className="flex items-start gap-2">
                    {n.accessible ? (
                      <Link href={`/n/${n.id}`} className="min-w-0 flex-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <h3 className="flex items-center gap-2 font-medium">
                          <span aria-hidden>{n.emoji ?? "📓"}</span>
                          <span className="truncate">{n.title}</span>
                        </h3>
                      </Link>
                    ) : (
                      <h3 className="flex min-w-0 flex-1 items-center gap-2 font-medium text-muted-foreground">
                        <Lock className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">{n.title}</span>
                      </h3>
                    )}
                    {n.canUnlink && isMember && (
                      <Button variant="ghost" size="icon-xs" aria-label={t("community.group.notebooks.unlink")} onClick={() => void unlink(n)} disabled={busy}>
                        <X />
                      </Button>
                    )}
                  </div>
                  {n.accessible ? <p className="line-clamp-2 text-xs text-muted-foreground">{n.description}</p> : <p className="text-xs text-muted-foreground">{t("community.group.notebooks.locked")}</p>}
                </Card>
              </li>
            ))}
          </ul>
        )}
        {isMember && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {adminNotebooks && adminNotebooks.length > 0 ? (
              <>
                <NativeSelect value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t("community.group.notebooks.pick")} className="sm:w-72" data-testid="group-notebook-pick">
                  <option value="">{t("community.group.notebooks.pick")}</option>
                  {adminNotebooks.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
                </NativeSelect>
                <Button variant="outline" onClick={() => void link()} disabled={!pick || busy} data-testid="group-notebook-link">
                  <Link2 /> {t("community.group.notebooks.link")}
                </Button>
              </>
            ) : adminNotebooks ? (
              <p className="text-xs text-muted-foreground">{t("community.group.notebooks.none")}</p>
            ) : null}
          </div>
        )}
      </section>

      {isMember && (
        <section className="space-y-3" aria-labelledby="g-members">
          <h2 id="g-members" className="text-base font-semibold">
            {t("community.group.members")} ({members.length})
          </h2>
          <ul className="divide-y rounded-xl border" data-testid="group-members">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 p-3">
                <UserAvatar name={m.name} image={m.image} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.email ? `${m.email} · ` : ""}
                    {formatRelative(m.joinedAt, locale)}
                  </p>
                </div>
                <Badge variant={m.role === "member" ? "outline" : "secondary"}>{t(roleKey(m.role))}</Badge>
                {canManage && m.role !== "owner" && m.userId !== meId && (group.myRole === "owner" || m.role === "member") && (
                  <Button variant="ghost" size="icon-xs" aria-label={t("community.group.removeMember")} onClick={() => void removeMember(m)} disabled={busy}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <form onSubmit={(e) => void addMember(e)} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("community.group.addMember.placeholder")} aria-label={t("community.group.addMember")} className="sm:w-72" data-testid="group-add-email" />
              <Button type="submit" variant="outline" disabled={busy || !email.trim()} data-testid="group-add-submit">
                <UserPlus /> {t("community.group.addMember.submit")}
              </Button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
