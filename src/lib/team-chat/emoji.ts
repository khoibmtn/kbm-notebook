/** Bộ emoji thông dụng cho picker (24 biểu tượng) và kiểm tra emoji hợp lệ cho reaction. */
export const COMMON_EMOJI = [
  "👍", "❤️", "😂", "😮", "😢", "🙏",
  "🎉", "🔥", "👏", "😍", "🤔", "😅",
  "👌", "💯", "✅", "❌", "👀", "😎",
  "🥳", "😭", "🤝", "💡", "⭐", "🚀",
] as const;

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/** Emoji hợp lệ cho reaction: ngắn, có ký tự pictographic (hoặc ký tự cờ/keycap), không có chữ thường. */
export function isValidReactionEmoji(s: string): boolean {
  if (!s || s.length > 32) return false;
  if (/[\p{L}\p{N}]/u.test(s.replace(/[#*0-9]️?⃣/u, ""))) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(s);
}
