"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";

export function AcceptInviteButton({ token }: { token: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      const res = await api<{ notebookId: string }>(`/api/invites/${token}/accept`, { method: "POST" });
      toast.success(t("invite.joined"));
      router.replace(`/n/${res.notebookId}`);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
      setBusy(false);
    }
  }

  return (
    <Button onClick={accept} disabled={busy} className="w-full">
      {busy && <Loader2 className="animate-spin" />} {t("invite.accept")}
    </Button>
  );
}
