import {
  AlignLeft,
  Braces,
  CirclePlay,
  File,
  FileCode,
  FileSpreadsheet,
  FileText,
  Globe,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import type { SourceDto } from "@/lib/sources";
import { cn } from "@/lib/utils";

type IconSpec = { icon: LucideIcon; className: string };

const BY_FILE_TYPE: Record<string, IconSpec> = {
  pdf: { icon: FileText, className: "text-red-600 dark:text-red-400" },
  docx: { icon: FileText, className: "text-blue-600 dark:text-blue-400" },
  pptx: { icon: Presentation, className: "text-orange-600 dark:text-orange-400" },
  xlsx: { icon: FileSpreadsheet, className: "text-green-600 dark:text-green-400" },
  csv: { icon: FileSpreadsheet, className: "text-green-600 dark:text-green-400" },
  md: { icon: FileCode, className: "text-slate-600 dark:text-slate-300" },
  txt: { icon: FileText, className: "text-slate-600 dark:text-slate-300" },
  html: { icon: Globe, className: "text-sky-600 dark:text-sky-400" },
  json: { icon: Braces, className: "text-amber-600 dark:text-amber-400" },
};

export function sourceIconSpec(source: Pick<SourceDto, "kind" | "fileType">): IconSpec {
  if (source.kind === "url") return { icon: Globe, className: "text-sky-600 dark:text-sky-400" };
  if (source.kind === "text") return { icon: AlignLeft, className: "text-slate-600 dark:text-slate-300" };
  if (source.kind === "youtube") return { icon: CirclePlay, className: "text-red-600 dark:text-red-400" };
  if (source.fileType && BY_FILE_TYPE[source.fileType]) return BY_FILE_TYPE[source.fileType];
  return { icon: File, className: "text-muted-foreground" };
}

export function SourceTypeIcon({ source, className }: { source: Pick<SourceDto, "kind" | "fileType">; className?: string }) {
  const { icon: Icon, className: color } = sourceIconSpec(source);
  return <Icon className={cn("size-4 shrink-0", color, className)} aria-hidden />;
}
