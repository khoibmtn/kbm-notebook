"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { Role } from "@/lib/roles";

export type NotebookInfo = {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  coverColor: string | null;
  systemInstruction: string | null;
  allowWeb: boolean;
  defaultArtifactVisibility: "private" | "notebook" | "link" | "public";
  ownerId: string;
};

export type CurrentUser = { id: string; name: string; email: string; image?: string | null };

type Ctx = { notebook: NotebookInfo; role: Role; user: CurrentUser };

const NotebookContext = createContext<Ctx | null>(null);

export function NotebookProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <NotebookContext.Provider value={value}>{children}</NotebookContext.Provider>;
}

export function useNotebook(): Ctx {
  const ctx = useContext(NotebookContext);
  if (!ctx) throw new Error("useNotebook phải nằm trong NotebookProvider");
  return ctx;
}
