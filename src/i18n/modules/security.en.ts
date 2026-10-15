import type { securityVi } from "./security.vi";

/** English strings for security-related UI. Must contain every key from security.vi.ts. */
export const securityEn: Record<keyof typeof securityVi, string> = {
  "studio.share.privateSourcesOnly": "This artifact was generated from private sources, so it can only stay Private. Regenerate it from shared sources to share it.",
  "studio.privateSourcesBadge": "Uses private sources",
};
