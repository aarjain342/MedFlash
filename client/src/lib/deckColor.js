// Every deck gets one of six "highlighter" colours, derived from its id so it never changes
// between visits or devices. It's only a scanning aid on the deck lists (see .deck-chip).
export const DECK_HUES = 6;

export function deckHue(key) {
  let hash = 0;
  for (const ch of String(key ?? '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % DECK_HUES;
}
