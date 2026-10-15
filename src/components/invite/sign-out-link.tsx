"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n-client";

export function SignOutLink({ next }: { next: string }) {
  const t = useT();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      onClick={async () => {
        await authClient.signOut();
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        router.refresh();
      }}
    >
      {t("invite.switchAccount")}
    </Button>
  );
}
