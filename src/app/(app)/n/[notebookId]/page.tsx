import { MainTabs } from "@/components/notebook/main-tabs";
import { NotebookWorkspace } from "@/components/notebook/notebook-workspace";
import { SourcesPanel } from "@/components/sources/sources-panel";
import { StudioPanel } from "@/components/studio/studio-panel";
import { env } from "@/server/env";

export default function NotebookHomePage() {
  return <NotebookWorkspace sources={<SourcesPanel maxUploadMb={env().MAX_UPLOAD_MB} />} main={<MainTabs />} studio={<StudioPanel />} />;
}
