"use client";
import { Check, Clock, Loader2, LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";

export type JoinState = "guest" | "member" | "pending" | "rejected" | "none";

/** Nút "Yêu cầu tham gia" của trang sổ tay công khai (khách → đăng nhập; thành viên → mở sổ tay). */
export function JoinRequestButton({ notebookId, slug, initial }: { notebookId: string; slug: string; initial: JoinState }) {
  const t = useT();
  const [state, setState] = useState<JoinState>(initial);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (state === "guest") {
    return (
      <Button asChild data-testid="join-login">
        <Link href={`/login?next=${encodeURIComponent(`/p/${slug}`)}`}>
          <LogIn /> {t("community.public.loginToJoin")}
        </Link>
      </Button>
    );
  }
  if (state === "member") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Check className="size-4 text-success" aria-hidden /> {t("community.public.member")}
        </span>
        <Button asChild variant="outline">
          <Link href={`/n/${notebookId}`}>{t("community.public.open")}</Link>
        </Button>
      </div>
    );
  }
  if (state === "pending") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status" data-testid="join-pending">
        <Clock className="size-4" aria-hidden /> {t("community.public.requestPending")}
      </span>
    );
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/notebooks/${notebookId}/join-requests`, { method: "POST", json: message.trim() ? { message: message.trim() } : {} });
      toast.success(t("community.public.requestSent"));
      setState("pending");
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {state === "rejected" && <span className="text-sm text-muted-foreground">{t("community.public.requestRejected")}</span>}
      <Button onClick={() => setOpen(true)} data-testid="join-request">
        <UserPlus /> {t("community.public.requestJoin")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={send} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("community.public.requestTitle")}</DialogTitle>
              <DialogDescription>{t("community.public.requestDescription")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="jr-msg">{t("community.public.requestMessage")}</Label>
              <Textarea id="jr-msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={500} placeholder={t("community.public.requestMessagePlaceholder")} data-testid="join-message" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy} data-testid="join-send">
                {busy && <Loader2 className="animate-spin" />} {t("community.public.requestSend")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
