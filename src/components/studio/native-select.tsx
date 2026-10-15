import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** `<select>` gốc với kiểu của dự án — gọn cho các trình chỉnh sửa dày đặc và dễ kiểm thử. */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}
