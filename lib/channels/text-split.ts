/**
 * Splits an outbound reply into parts a channel will accept — plan finding F5.
 *
 * Instagram caps text at 1000 UTF-8 *bytes*, not characters, and Sinhala, Tamil and Arabic take 2–3 bytes per
 * character, so a perfectly reasonable 400-character reply overflows. Blocking such a reply would silence the
 * assistant in exactly the languages the agency serves; splitting it does not. Messenger counts characters.
 *
 * Splits at the coarsest boundary that fits — paragraph, then line, then sentence (including the Sinhala/Tamil
 * "।" and Arabic "؟" "۔" marks), then word — and only as a last resort between grapheme clusters, so it never
 * cuts an emoji, a combining mark or a conjunct consonant in half. Pure and dependency-free.
 */

export type TextUnit = "chars" | "bytes";

export interface TextLimit {
  unit: TextUnit;
  /** The platform's stated maximum. For bytes, Meta says "under 1000", so the largest allowed part is size − 1. */
  size: number;
}

const encoder = new TextEncoder();

function measure(text: string, unit: TextUnit): number {
  return unit === "bytes" ? encoder.encode(text).length : text.length;
}

const SEPARATORS: ReadonlyArray<{ split: RegExp; join: string }> = [
  { split: /\n{2,}/, join: "\n\n" },
  { split: /\n/, join: "\n" },
  { split: /(?<=[.!?…।؟۔])\s+/u, join: " " },
  { split: /\s+/, join: " " },
];

export function splitForChannel(text: string, limit: TextLimit): string[] {
  const allowed = limit.unit === "bytes" ? limit.size - 1 : limit.size;
  const fits = (value: string) => measure(value, limit.unit) <= allowed;

  function splitGraphemes(value: string): string[] {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const parts: string[] = [];
    let current = "";
    for (const { segment } of segmenter.segment(value)) {
      if (current && !fits(current + segment)) {
        parts.push(current);
        current = "";
      }
      current += segment;
    }
    if (current) parts.push(current);
    return parts;
  }

  function chunk(value: string, level: number): string[] {
    if (fits(value)) return [value];
    if (level >= SEPARATORS.length) return splitGraphemes(value);

    const { split, join } = SEPARATORS[level];
    const pieces = value
      .split(split)
      .map((piece) => piece.trim())
      .filter((piece) => piece.length > 0);
    if (pieces.length <= 1) return chunk(value, level + 1); // this separator isn't present — try a finer one

    const parts: string[] = [];
    let current = "";
    for (const piece of pieces) {
      if (!fits(piece)) {
        if (current) parts.push(current);
        current = "";
        parts.push(...chunk(piece, level + 1));
        continue;
      }
      const candidate = current ? `${current}${join}${piece}` : piece;
      if (fits(candidate)) {
        current = candidate;
      } else {
        parts.push(current);
        current = piece;
      }
    }
    if (current) parts.push(current);
    return parts;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  return chunk(trimmed, 0);
}
