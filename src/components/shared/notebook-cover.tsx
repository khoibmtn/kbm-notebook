import { DEFAULT_COVER_COLOR } from "@/lib/notebook-colors";
import { cn } from "@/lib/utils";

/**
 * Dải màu bìa + emoji của sổ tay. Màu bìa là màu pastel sáng nên ở chế độ tối được làm dịu (lớp nền mờ 35%)
 * để không chói trên nền tối.
 */
export function NotebookCover({ color, emoji, className }: { color: string | null; emoji: string | null; className?: string }) {
  return (
    <div className={cn("relative flex items-end overflow-hidden", className)}>
      <div className="absolute inset-0 dark:opacity-35" style={{ backgroundColor: color ?? DEFAULT_COVER_COLOR }} aria-hidden />
      <span className="relative" aria-hidden>
        {emoji ?? "📓"}
      </span>
    </div>
  );
}
