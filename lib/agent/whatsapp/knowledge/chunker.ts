/**
 * Splits a knowledge document into searchable pieces. Pure and dependency-free so it can be unit
 * tested — see chunker.test.ts and §6 of docs/modules/whatsapp-knowledge-base-implementation-plan.md.
 *
 * Sizes are in characters, not tokens: token count is estimated as characters ÷ 4, which is close
 * enough for English and avoids a tokenizer dependency. ~800 tokens per piece, ~100 tokens of overlap
 * so a sentence that straddles a boundary still appears whole in one piece.
 */

export const KNOWLEDGE_CHUNK_TARGET_CHARS = 3200;
export const KNOWLEDGE_CHUNK_OVERLAP_CHARS = 400;

export interface KnowledgeChunkDraft {
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Collapses runs of blank lines and trailing spaces so paragraph detection is predictable. */
function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits an oversized paragraph on sentence ends, then on spaces, then hard, so no piece exceeds `limit`. */
function splitOversizedParagraph(paragraph: string, limit: number): string[] {
  const pieces: string[] = [];
  let remaining = paragraph;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    // Prefer the last sentence end in the back half of the window, then the last space, then a hard cut.
    const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
    let cut = sentenceEnd > limit / 2 ? sentenceEnd + 1 : window.lastIndexOf(" ");
    if (cut <= 0) cut = limit;
    pieces.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) pieces.push(remaining);
  return pieces;
}

/** The tail of `text`, trimmed forward to a word boundary, used to seed the next piece. */
function overlapTail(text: string, overlapChars: number): string {
  if (overlapChars <= 0 || text.length <= overlapChars) return overlapChars <= 0 ? "" : text;
  const tail = text.slice(text.length - overlapChars);
  const firstSpace = tail.indexOf(" ");
  return firstSpace === -1 ? tail : tail.slice(firstSpace + 1);
}

export function chunkKnowledgeText(
  rawText: string,
  options: { targetChars?: number; overlapChars?: number } = {},
): KnowledgeChunkDraft[] {
  const targetChars = options.targetChars ?? KNOWLEDGE_CHUNK_TARGET_CHARS;
  const overlapChars = Math.min(options.overlapChars ?? KNOWLEDGE_CHUNK_OVERLAP_CHARS, Math.floor(targetChars / 2));

  const text = normaliseWhitespace(rawText);
  if (text.length === 0) return [];

  // Leave room for the overlap so seeding a piece with the previous tail never pushes it past the target.
  const paragraphLimit = targetChars - overlapChars;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .flatMap((paragraph) => (paragraph.length > paragraphLimit ? splitOversizedParagraph(paragraph, paragraphLimit) : [paragraph]));

  const pieces: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const joined = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;
    if (joined.length <= targetChars) {
      current = joined;
      continue;
    }
    pieces.push(current);
    const tail = overlapTail(current, overlapChars);
    const seeded = tail.length > 0 ? `${tail}\n\n${paragraph}` : paragraph;
    current = seeded.length <= targetChars ? seeded : paragraph;
  }
  if (current.length > 0) pieces.push(current);

  return pieces.map((content, chunkIndex) => ({ chunkIndex, content, tokenEstimate: estimateTokens(content) }));
}
