import {
  BarChart3,
  FileText,
  GraduationCap,
  History,
  Layers,
  ListChecks,
  Network,
  NotebookPen,
  Presentation,
  Table2,
  CircleHelp,
  type LucideIcon,
} from "lucide-react";
import type { ArtifactTypeName, ExportFormat } from "@/lib/artifacts/meta";
import type { MessageKey } from "@/lib/i18n";

/** Loại hiển thị trong lưới Studio (ghi chú `note` thuộc mô-đun Notes nên không có thẻ tạo ở đây). */
export const STUDIO_TYPES: readonly ArtifactTypeName[] = [
  "report",
  "study_guide",
  "faq",
  "timeline",
  "quiz",
  "flashcards",
  "mindmap",
  "data_table",
  "slide_deck",
  "infographic",
] as const;

export const TYPE_ICONS: Record<ArtifactTypeName, LucideIcon> = {
  note: NotebookPen,
  report: FileText,
  study_guide: GraduationCap,
  faq: CircleHelp,
  timeline: History,
  quiz: ListChecks,
  flashcards: Layers,
  mindmap: Network,
  data_table: Table2,
  slide_deck: Presentation,
  infographic: BarChart3,
};

export const TYPE_NAME_KEY: Record<ArtifactTypeName, MessageKey> = {
  note: "artifact.note",
  report: "artifact.report",
  study_guide: "artifact.study_guide",
  faq: "artifact.faq",
  timeline: "artifact.timeline",
  mindmap: "artifact.mindmap",
  slide_deck: "artifact.slide_deck",
  infographic: "artifact.infographic",
  quiz: "artifact.quiz",
  flashcards: "artifact.flashcards",
  data_table: "artifact.data_table",
};

export const TYPE_DESC_KEY: Record<ArtifactTypeName, MessageKey> = {
  note: "studio.type.note.desc",
  report: "studio.type.report.desc",
  study_guide: "studio.type.study_guide.desc",
  faq: "studio.type.faq.desc",
  timeline: "studio.type.timeline.desc",
  mindmap: "studio.type.mindmap.desc",
  slide_deck: "studio.type.slide_deck.desc",
  infographic: "studio.type.infographic.desc",
  quiz: "studio.type.quiz.desc",
  flashcards: "studio.type.flashcards.desc",
  data_table: "studio.type.data_table.desc",
};

export const FORMAT_LABEL_KEY: Record<ExportFormat, MessageKey> = {
  pptx: "studio.format.pptx",
  docx: "studio.format.docx",
  pdf: "studio.format.pdf",
  png: "studio.format.png",
  svg: "studio.format.svg",
  csv: "studio.format.csv",
  md: "studio.format.md",
  json: "studio.format.json",
  apkg_tsv: "studio.format.apkg_tsv",
};
