"use client";
import type { ComponentProps, ComponentType } from "react";
import { InfographicView } from "./infographic/infographic-view";
import { SlideEditor } from "./slides/slide-editor";

/**
 * ĐIỂM NỐI DUY NHẤT phía giao diện với engine slide/infographic (docs/06-slide-engine.md).
 * Phía máy chủ được đăng ký ở `src/server/artifacts/registry.ts`.
 */
export type { SlideDeckContent } from "@/server/artifacts/slides/types";
export type { InfographicContent } from "@/server/artifacts/infographic/types";

export type SlideEditorProps = ComponentProps<typeof SlideEditor>;
export type InfographicViewProps = ComponentProps<typeof InfographicView>;

export type ClientEngines = {
  SlideEditor: ComponentType<SlideEditorProps>;
  InfographicView: ComponentType<InfographicViewProps>;
};

export const clientEngines: ClientEngines = { SlideEditor, InfographicView };
