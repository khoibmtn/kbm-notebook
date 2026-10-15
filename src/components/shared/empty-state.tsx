import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Props = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Hiển thị nhãn "Đang phát triển" cho module chưa có. */
  badge?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, badge, action, className }: Props) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center", className)}>
      {Icon && (
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-6" aria-hidden />
        </span>
      )}
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {badge && <Badge variant="secondary">{badge}</Badge>}
      {action}
    </div>
  );
}
