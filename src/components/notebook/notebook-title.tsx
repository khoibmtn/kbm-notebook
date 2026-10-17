"use client";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useNotebook } from "@/components/notebook/notebook-context";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import { hasRole } from "@/lib/roles";

/** Tiêu đề sổ tay trên top bar; admin+ đổi tên tại chỗ. */
export function NotebookTitle() {
  const t = useT();
  const router = useRouter();
  const { notebook, role } = useNotebook();
  const canEdit = hasRole(role, "admin");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(notebook.title);
  const cancelled = useRef(false);

  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      setEditing(false);
      return;
    }
    const next = value.trim();
    setEditing(false);
    if (!next || next === notebook.title) {
      setValue(notebook.title);
      return;
    }
    try {
      await api(`/api/notebooks/${notebook.id}`, { method: "PATCH", json: { title: next } });
      toast.success(t("common.saved"));
      router.refresh();
    } catch (e) {
      setValue(notebook.title);
      toast.error(errorMessage(e, t("common.error")));
    }
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={value}
        maxLength={120}
        aria-label={t("notebook.rename")}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            setValue(notebook.title);
            e.currentTarget.blur();
          }
        }}
        className="h-8 max-w-md"
      />
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span aria-hidden className="text-lg">
        {notebook.emoji ?? "📓"}
      </span>
      {canEdit ? (
        <button
          type="button"
          onClick={() => {
            setValue(notebook.title);
            setEditing(true);
          }}
          title={t("notebook.rename")}
          className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-accent"
        >
          <h1 className="truncate text-sm font-semibold">{notebook.title}</h1>
          <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
        </button>
      ) : (
        <h1 className="truncate px-1.5 text-sm font-semibold">{notebook.title}</h1>
      )}
    </div>
  );
}
