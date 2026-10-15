"use client";
import { Check, Copy, Loader2, LogOut, MailPlus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RoleBadge } from "@/components/dashboard/role-badge";
import { useNotebook } from "@/components/notebook/notebook-context";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api-client";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import { useRealtimeEvent } from "@/lib/realtime";
import type { MessageKey } from "@/lib/i18n";
import { assignableRoles, hasRole, roleRank, type Role } from "@/lib/roles";

type Member = { userId: string; name: string; email: string; image: string | null; role: Role; joinedAt: string };
type Invite = { id: string; email: string; role: Role; token: string; expiresAt: string; createdAt: string };

function inviteUrl(token: string) {
  return `${window.location.origin}/invite/${token}`;
}

async function copy(text: string, ok: string, fail: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch {
    toast.error(fail);
  }
}

export function MembersPanel() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const { notebook, role, user } = useNotebook();
  const canManage = hasRole(role, "admin");
  const assignable = assignableRoles(role);

  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("viewer");
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);

  const base = `/api/notebooks/${notebook.id}`;

  // Tải danh sách; tăng `version` để tải lại sau mỗi thao tác.
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    api<{ members: Member[]; invites: Invite[] }>(`${base}/members`)
      .then((res) => {
        if (cancelled) return;
        setMembers(res.members);
        setInvites(res.invites);
      })
      .catch((e) => {
        if (!cancelled) toast.error(errorMessage(e, t("common.error")));
      });
    return () => {
      cancelled = true;
    };
  }, [base, version, t]);

  // Thành viên khác đổi danh sách (realtime) → tải lại.
  useRealtimeEvent("member:changed", reload);

  const roleToInvite: Role = assignable.includes(inviteRole) ? inviteRole : (assignable[0] ?? "viewer");

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setLastLink(null);
    try {
      const res = await api<
        { status: "added" } | { status: "invited"; invite: { link: string; email: string } }
      >(`${base}/members`, { method: "POST", json: { email: email.trim(), role: roleToInvite } });
      if (res.status === "added") toast.success(t("members.added"));
      else {
        setLastLink(`${window.location.origin}${res.invite.link}`);
        toast.success(t("members.invited"));
      }
      setEmail("");
      reload();
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(m: Member, next: Role) {
    try {
      await api(`${base}/members/${m.userId}`, { method: "PATCH", json: { role: next } });
      toast.success(t("common.saved"));
      reload();
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    }
  }

  async function remove(m: Member) {
    const self = m.userId === user.id;
    if (!window.confirm(self ? t("members.leave.confirm") : t("members.remove.confirm", { name: m.name }))) return;
    try {
      await api(`${base}/members/${m.userId}`, { method: "DELETE" });
      toast.success(self ? t("members.left") : t("members.removed"));
      if (self) {
        router.replace("/");
        router.refresh();
        return;
      }
      reload();
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    }
  }

  async function revoke(i: Invite) {
    try {
      await api(`${base}/invites/${i.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    }
  }

  function canChange(m: Member) {
    if (!canManage || m.role === "owner" || m.userId === user.id) return false;
    return role === "owner" || roleRank(m.role) < roleRank(role);
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <form onSubmit={invite} className="space-y-2" aria-label={t("members.invite.title")}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("members.invite.placeholder")}
              aria-label={t("auth.email")}
              className="flex-1"
            />
            <Select value={roleToInvite} onValueChange={(v) => setInviteRole(v as Role)}>
              <SelectTrigger className="sm:w-36" aria-label={t("members.role")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignable.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`role.${r}` as MessageKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={busy || !email.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <MailPlus />}
              {t("members.invite.submit")}
            </Button>
          </div>
          {lastLink && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2 text-xs">
              <span className="min-w-0 flex-1 truncate" data-testid="invite-link">
                {lastLink}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => copy(lastLink, t("members.link.copied"), t("common.error"))}>
                <Copy /> {t("members.link.copy")}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("members.invite.hint")}</p>
        </form>
      )}

      <section aria-label={t("members.list")} className="space-y-2">
        <h3 className="text-sm font-medium">
          {t("members.list")} {members ? `(${members.length})` : null}
        </h3>
        {members === null ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <ul className="divide-y rounded-lg border" data-testid="member-list">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 p-3">
                <UserAvatar name={m.name} image={m.image} className="size-9" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {m.name} {m.userId === user.id && <span className="text-muted-foreground">({t("members.you")})</span>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                </div>
                {canChange(m) ? (
                  <Select value={m.role} onValueChange={(v) => changeRole(m, v as Role)}>
                    <SelectTrigger size="sm" className="w-28" aria-label={t("members.role")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {assignable.map((r) => (
                        <SelectItem key={r} value={r}>
                          {t(`role.${r}` as MessageKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <RoleBadge role={m.role} />
                )}
                {canChange(m) && (
                  <Button variant="ghost" size="icon" onClick={() => remove(m)} aria-label={t("members.remove")}>
                    <Trash2 className="text-destructive" />
                  </Button>
                )}
                {m.userId === user.id && m.role !== "owner" && (
                  <Button variant="ghost" size="sm" onClick={() => remove(m)}>
                    <LogOut /> {t("members.leave")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && invites.length > 0 && (
        <section aria-label={t("members.pending")} className="space-y-2">
          <h3 className="text-sm font-medium">{t("members.pending")}</h3>
          <ul className="divide-y rounded-lg border">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{i.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("members.pending.expires", { when: formatRelative(i.expiresAt, locale) })}
                  </div>
                </div>
                <RoleBadge role={i.role} />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("members.link.copy")}
                  onClick={() => copy(inviteUrl(i.token), t("members.link.copied"), t("common.error"))}
                >
                  <Copy />
                </Button>
                <Button variant="ghost" size="icon" aria-label={t("members.invite.revoke")} onClick={() => revoke(i)}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!canManage && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3" /> {t("members.readonly")}
        </p>
      )}
    </div>
  );
}

export function MembersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("notebook.share")}</DialogTitle>
          <DialogDescription>{t("members.description")}</DialogDescription>
        </DialogHeader>
        {open && <MembersPanel />}
      </DialogContent>
    </Dialog>
  );
}
