"use client";
import { Loader2, MailWarning } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n-client";

/** Nút “Gửi lại email xác minh” (dùng ở banner và trang lời mời). */
export function ResendVerificationButton({ email, callbackURL = "/", variant = "outline" }: { email: string; callbackURL?: string; variant?: "outline" | "secondary" }) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    try {
      const res = await authClient.sendVerificationEmail({ email, callbackURL });
      if (res.error) toast.error(t("auth.verify.resendFailed"));
      else toast.success(t("auth.verify.sent", { email }));
    } catch {
      toast.error(t("auth.verify.resendFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" size="sm" variant={variant} onClick={resend} disabled={busy} data-testid="resend-verification">
      {busy && <Loader2 className="animate-spin" />} {t("auth.verify.resend")}
    </Button>
  );
}

/** Banner “Email chưa xác minh” — chỉ hiển thị khi máy chủ yêu cầu xác minh và tài khoản chưa xác minh. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const t = useT();
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-warning/10 px-4 py-2 text-sm" data-testid="verify-email-banner">
      <MailWarning className="size-4 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1 basis-64">{t("auth.verify.banner")}</p>
      <ResendVerificationButton email={email} />
    </div>
  );
}
