import sample from "../../../src/app/(app)/dev/slides/sample-deck.json";
import { slideDeckSchema, type SlideDeckContent } from "../../../src/server/artifacts/slides/types";

/** Bộ deck dev fixture (đã parse qua schema) dùng chung cho các test slides. */
export function sampleDeck(): SlideDeckContent {
  return slideDeckSchema.parse(JSON.parse(JSON.stringify(sample)));
}
