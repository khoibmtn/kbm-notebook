"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BarChart3, Columns2, Copy, Flag, Heading1, ImageIcon, List, Plus, Presentation, Quote, Table2, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n-client";
import { LAYOUT_LABEL_KEYS, SLIDE_LAYOUTS, type Slide, type SlideLayout, type SlideTheme } from "@/server/artifacts/slides/types";
import { SlideView } from "./slide-view";

export const LAYOUT_ICONS: Record<SlideLayout, LucideIcon> = {
  title: Presentation,
  section: Heading1,
  title_bullets: List,
  two_column: Columns2,
  image_text: ImageIcon,
  chart: BarChart3,
  quote: Quote,
  table: Table2,
  closing: Flag,
};

export const THUMB_SCALE = 0.14;

export function LayoutPicker({
  value,
  onPick,
  columns = 3,
  testPrefix = "layout",
}: {
  value?: SlideLayout;
  onPick: (l: SlideLayout) => void;
  columns?: 2 | 3;
  testPrefix?: string;
}) {
  const t = useT();
  return (
    <div className={cn("grid gap-1.5", columns === 3 ? "grid-cols-3" : "grid-cols-2")} role="listbox" aria-label={t("slides.panel.layout")}>
      {SLIDE_LAYOUTS.map((l) => {
        const Icon = LAYOUT_ICONS[l];
        const active = l === value;
        return (
          <button
            key={l}
            type="button"
            role="option"
            aria-selected={active}
            data-testid={`${testPrefix}-${l}`}
            onClick={() => onPick(l)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-md border px-1.5 py-2 text-center text-[11px] leading-tight transition-colors hover:bg-accent",
              active ? "border-primary bg-primary/5 text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {t(LAYOUT_LABEL_KEYS[l])}
          </button>
        );
      })}
    </div>
  );
}

type ItemProps = {
  slide: Slide;
  index: number;
  total: number;
  theme: SlideTheme;
  selected: boolean;
  readOnly: boolean;
  resolveImageUrl?: (fileId: string) => string;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

function RailItem({ slide, index, total, theme, selected, readOnly, resolveImageUrl, onSelect, onDuplicate, onDelete }: ItemProps) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id, disabled: readOnly });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={cn("group relative flex shrink-0 items-start gap-1.5", isDragging && "opacity-80")}
      data-testid="slide-thumb"
      data-slide-id={slide.id}
    >
      <span className="w-5 shrink-0 pt-1 text-right text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
      <div
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        aria-label={t("slides.rail.slideN", { n: index + 1, title: slide.title || t("slides.placeholder.title") })}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSelect();
            return;
          }
          listeners?.onKeyDown?.(e);
        }}
        className={cn(
          "relative overflow-hidden rounded-md border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "border-primary" : "border-border hover:border-primary/40",
          readOnly ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        )}
      >
        <div className="pointer-events-none">
          <SlideView slide={slide} theme={theme} index={index} total={total} scale={THUMB_SCALE} resolveImageUrl={resolveImageUrl} />
        </div>
      </div>
      {!readOnly && (
        <div className="absolute right-1 top-1 hidden gap-0.5 rounded-md bg-background/90 p-0.5 shadow-sm group-hover:flex group-focus-within:flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title={t("slides.rail.duplicate")}
            aria-label={t("slides.rail.duplicate")}
            data-testid="slide-duplicate"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
          >
            <Copy />
          </Button>
          {total > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title={t("slides.rail.delete")}
              aria-label={t("slides.rail.delete")}
              data-testid="slide-delete"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function SlideRail({
  slides,
  theme,
  selectedId,
  readOnly,
  horizontal,
  resolveImageUrl,
  onSelect,
  onReorder,
  onAdd,
  onDuplicate,
  onDelete,
}: {
  slides: Slide[];
  theme: SlideTheme;
  selectedId: string;
  readOnly: boolean;
  horizontal: boolean;
  resolveImageUrl?: (fileId: string) => string;
  onSelect: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: (layout: SlideLayout) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  const [addOpen, setAddOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Space nhấc/thả slide để sắp xếp bằng bàn phím; Enter chỉ chọn slide.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = slides.findIndex((s) => s.id === e.active.id);
    const to = slides.findIndex((s) => s.id === e.over?.id);
    if (from >= 0 && to >= 0) onReorder(from, to);
  };

  return (
    <div className={cn("flex min-h-0 min-w-0", horizontal ? "flex-row items-start gap-3 overflow-x-auto p-2" : "w-[220px] shrink-0 flex-col border-r")} data-testid="slide-rail">
      {!readOnly && (
        <div className={cn(horizontal ? "shrink-0" : "border-b p-2")}>
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className={cn(!horizontal && "w-full")} data-testid="slide-add">
                <Plus /> {t("slides.rail.add")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t("slides.rail.addTitle")}</p>
              <LayoutPicker
                testPrefix="add-layout"
                onPick={(l) => {
                  setAddOpen(false);
                  onAdd(l);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      )}
      <div
        className={cn(horizontal ? "flex gap-3" : "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2")}
        role="list"
        aria-label={t("slides.rail.label")}
        data-testid="slide-list"
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={slides.map((s) => s.id)} strategy={horizontal ? horizontalListSortingStrategy : verticalListSortingStrategy}>
            {slides.map((s, i) => (
              <RailItem
                key={s.id}
                slide={s}
                index={i}
                total={slides.length}
                theme={theme}
                selected={s.id === selectedId}
                readOnly={readOnly}
                resolveImageUrl={resolveImageUrl}
                onSelect={() => onSelect(s.id)}
                onDuplicate={() => onDuplicate(s.id)}
                onDelete={() => onDelete(s.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
