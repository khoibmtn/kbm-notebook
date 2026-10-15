"use client";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n-client";
import type { MessageKey } from "@/lib/i18n";

export type RoleName = "owner" | "admin" | "editor" | "viewer";

export function RoleBadge({ role }: { role: RoleName }) {
  const t = useT();
  return (
    <Badge variant={role === "owner" ? "default" : "secondary"} className="font-normal">
      {t(`role.${role}` as MessageKey)}
    </Badge>
  );
}
