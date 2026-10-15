"use client";
import { COMMON_EMOJI } from "@/lib/team-chat/emoji";
import { useT } from "@/lib/i18n-client";

/** Lưới 24 emoji thông dụng. */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const t = useT();
  return (
    <div role="listbox" aria-label={t("team.emoji.title")} className="grid grid-cols-6 gap-1 p-1" data-testid="emoji-picker">
      {COMMON_EMOJI.map((e) => (
        <button
          key={e}
          type="button"
          role="option"
          aria-selected={false}
          aria-label={e}
          onClick={() => onPick(e)}
          className="flex size-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        >
          {e}
        </button>
      ))}
    </div>
  );
}
