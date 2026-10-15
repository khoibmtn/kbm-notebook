"use client";

import { useState } from "react";
import { InfographicView } from "@/components/studio/infographic/infographic-view";
import { infographicSchema, type InfographicContent } from "@/server/artifacts/infographic/types";

export function DevInfographic({ initial, banner }: { initial: unknown; banner: string }) {
  const [content, setContent] = useState<InfographicContent>(() => infographicSchema.parse(initial));
  const [orientation, setOrientation] = useState(content.orientation);
  return (
    <div className="mx-auto max-w-5xl space-y-3 p-4">
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900" data-testid="dev-banner">
        {banner}
      </p>
      <div className="flex gap-2 text-sm">
        {(["portrait", "landscape"] as const).map((o) => (
          <button
            key={o}
            type="button"
            data-testid={`orientation-${o}`}
            className={`rounded-md border px-3 py-1 ${orientation === o ? "bg-primary text-primary-foreground" : ""}`}
            onClick={() => {
              setOrientation(o);
              setContent((c) => ({ ...c, orientation: o }));
            }}
          >
            {o}
          </button>
        ))}
      </div>
      <InfographicView content={content} onChange={setContent} />
    </div>
  );
}
