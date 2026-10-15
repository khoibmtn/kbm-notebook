"use client";
import { Copy, Link2, Loader2, RefreshCw, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import type { ArtifactDetailDto, ArtifactShareDto, ArtifactVisibility } from "@/lib/artifacts/meta";
import { ARTIFACT_VISIBILITIES } from "@/lib/artifacts/meta";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import { NativeSelect } from "./native-select";

const LABEL: Record<ArtifactVisibility, MessageKey> = {
  private: "studio.share.private",
  notebook: "studio.share.notebook",
  link: "studio.share.link",
  public: "studio.share.public",
};
const DESC: Record<ArtifactVisibility, MessageKey> = {
  private: "studio.share.private.desc",
  notebook: "studio.share.notebook.desc",
  link: "studio.share.link.desc",
  public: "studio.share.public.desc",
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifact: Pick<ArtifactDetailDto, "id" | "title" | "visibility" | "shareToken" | "canManage">;
  /** Chỉ chủ sổ tay được chia sẻ công khai. */
  isNotebookOwner: boolean;
  /** Báo bản ghi mới sau khi đổi chế độ chia sẻ. */
  onChanged: (a: ArtifactDetailDto) => void;
};

/** Hộp chia sẻ: chế độ hiển thị (4 mức có giải thích), sao chép liên kết, danh sách chia sẻ riêng theo email. */
export function ShareDialog({ open, onOpenChange, artifact, isNotebookOwner, onChanged }: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [shares, setShares] = useState<ArtifactShareDto[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"view" | "edit">("view");
  const canManage = artifact.canManage;

  const loadShares = useCallback(async () => {
    if (!canManage) return;
    try {
      const res = await api<{ shares: ArtifactShareDto[] }>(`/api/artifacts/${artifact.id}/shares`);
      setShares(res.shares);
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  }, [artifact.id, canManage, t]);

  useEffect(() => {
    if (!open || !canManage) return;
    let cancelled = false;
    api<{ shares: ArtifactShareDto[] }>(`/api/artifacts/${artifact.id}/shares`)
      .then((res) => {
        if (!cancelled) setShares(res.shares);
      })
      .catch((e) => {
        if (!cancelled) toast.error(errorMessage(e, t("common.error")));
      });
    return () => {
      cancelled = true;
    };
  }, [open, canManage, artifact.id, t]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link =
    artifact.visibility === "link" && artifact.shareToken
      ? `${origin}/s/${artifact.shareToken}`
      : artifact.visibility === "public"
        ? `${origin}/a/${artifact.id}`
        : null;

  const setVisibility = async (visibility: ArtifactVisibility, rotateToken = false) => {
    setBusy(true);
    try {
      const res = await api<{ artifact: ArtifactDetailDto }>(`/api/artifacts/${artifact.id}/share`, { method: "PATCH", json: { visibility, rotateToken } });
      onChanged(res.artifact);
      toast.success(t("studio.share.updated"));
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("studio.share.copied"));
    } catch {
      toast.error(t("studio.share.copyFailed"));
    }
  };

  const addShare = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await api(`/api/artifacts/${artifact.id}/shares`, { method: "POST", json: { email: email.trim(), role } });
      setEmail("");
      await loadShares();
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  };

  const removeShare = async (id: string) => {
    try {
      await api(`/api/artifacts/${artifact.id}/shares/${id}`, { method: "DELETE" });
      await loadShares();
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>{t("studio.share.title", { name: artifact.title })}</DialogTitle>
          <DialogDescription>{t("studio.share.description")}</DialogDescription>
        </DialogHeader>

        {!canManage && <p className="text-sm text-muted-foreground">{t("studio.share.readOnly")}</p>}

        <fieldset className="space-y-2" disabled={!canManage || busy}>
          <legend className="sr-only">{t("studio.share.visibility")}</legend>
          {ARTIFACT_VISIBILITIES.map((v) => {
            const disabled = v === "public" && !isNotebookOwner;
            const active = artifact.visibility === v;
            return (
              <label
                key={v}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-accent/40",
                  active && "border-primary bg-primary/5",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <input type="radio" name="artifact-visibility" className="mt-1" checked={active} disabled={disabled} onChange={() => void setVisibility(v)} data-testid={`visibility-${v}`} />
                <span>
                  <span className="block font-medium">{t(LABEL[v])}</span>
                  <span className="block text-muted-foreground">{t(DESC[v])}</span>
                  {disabled && <span className="block text-xs text-warning">{t("studio.share.publicOwnerOnly")}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>

        {link && (
          <div className="space-y-1.5" data-testid="share-link-box">
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={t("studio.share.linkLabel")} data-testid="share-link" />
              <Button variant="outline" onClick={() => void copy()} data-testid="share-copy">
                <Copy /> {t("studio.share.copy")}
              </Button>
            </div>
            {artifact.visibility === "link" && canManage && (
              <Button variant="ghost" size="sm" onClick={() => void setVisibility("link", true)} disabled={busy}>
                <RefreshCw /> {t("studio.share.rotate")}
              </Button>
            )}
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Link2 className="size-3" /> {t("studio.share.linkHint")}
            </p>
          </div>
        )}

        {canManage && (
          <div className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold">{t("studio.share.people")}</h3>
            <div className="flex gap-2">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addShare()} placeholder={t("studio.share.emailPlaceholder")} aria-label={t("studio.share.emailPlaceholder")} />
              <NativeSelect value={role} onChange={(e) => setRole(e.target.value as "view" | "edit")} aria-label={t("studio.share.role")}>
                <option value="view">{t("studio.share.role.view")}</option>
                <option value="edit">{t("studio.share.role.edit")}</option>
              </NativeSelect>
              <Button onClick={() => void addShare()} disabled={busy || !email.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <UserPlus />} {t("studio.share.add")}
              </Button>
            </div>
            {shares === null ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : shares.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("studio.share.noPeople")}</p>
            ) : (
              <ul className="divide-y rounded-lg border" data-testid="share-people">
                {shares.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {s.name ? `${s.name} · ` : ""}
                      {s.email ?? s.userId}
                    </span>
                    <span className="text-xs text-muted-foreground">{t(s.role === "edit" ? "studio.share.role.edit" : "studio.share.role.view")}</span>
                    <Button size="icon-sm" variant="ghost" onClick={() => void removeShare(s.id)} aria-label={t("studio.share.remove", { who: s.email ?? "" })}>
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
