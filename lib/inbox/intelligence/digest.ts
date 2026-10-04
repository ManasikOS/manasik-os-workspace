/**
 * The rolling conversation digest — MI2.4 of docs/inbox/implementation-plan.md (Architecture §6 S1).
 *
 * S1 never reads a whole thread: it reads a digest of at most `DIGEST_TOKEN_BUDGET` tokens, kept up to date by
 * appending each new turn to the previous digest and dropping the OLDEST turns first when the budget is exceeded.
 * That is what keeps a 300-message conversation costing the same to triage as a 3-message one.
 *
 * Pure: no I/O, no clock, no model. Tokens are estimated, not counted — Latin text at ~4 characters per token, and
 * Sinhala/Tamil (which tokenise far worse) at ~1.5 — deliberately on the pessimistic side, so the real count never
 * exceeds the budget.
 */

export const DIGEST_TOKEN_BUDGET = 400;
/** One turn is cut to this many characters before it enters the digest, so a pasted essay cannot evict everything else. */
export const DIGEST_TURN_MAX_CHARS = 240;

export type DigestSpeaker = "customer" | "team";

export interface DigestTurn {
  speaker: DigestSpeaker;
  text: string;
}

const NON_LATIN_LETTER = /[\p{L}\p{M}]/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

/** A pessimistic token estimate that does not undercount Sinhala/Tamil. */
export function estimateTokens(text: string): number {
  let latin = 0;
  let other = 0;
  for (const char of text) {
    if (LATIN_LETTER.test(char) || !NON_LATIN_LETTER.test(char)) latin += 1;
    else other += 1;
  }
  return Math.ceil(latin / 4 + other / 1.5);
}

const SPEAKER_LABEL: Record<DigestSpeaker, string> = { customer: "C", team: "T" };

function cleanTurnText(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= DIGEST_TURN_MAX_CHARS) return collapsed;
  return `${Array.from(collapsed).slice(0, DIGEST_TURN_MAX_CHARS - 1).join("")}…`;
}

export function formatDigestTurn(turn: DigestTurn): string | null {
  const text = cleanTurnText(turn.text);
  return text.length === 0 ? null : `${SPEAKER_LABEL[turn.speaker]}: ${text}`;
}

/**
 * Appends `newTurns` to `previous` and trims from the front until it fits. Always keeps the newest turn, even if that
 * one turn alone is over budget (it is already capped at `DIGEST_TURN_MAX_CHARS`, so it cannot be by much).
 * Returns `null` when there is nothing to say.
 */
export function updateDigest(previous: string | null, newTurns: readonly DigestTurn[], budgetTokens: number = DIGEST_TOKEN_BUDGET): string | null {
  const lines = (previous ?? "").split("\n").filter((line) => line.length > 0);
  for (const turn of newTurns) {
    const line = formatDigestTurn(turn);
    if (line) lines.push(line);
  }
  if (lines.length === 0) return null;

  let total = lines.reduce((sum, line) => sum + estimateTokens(line) + 1, 0);
  while (lines.length > 1 && total > budgetTokens) {
    const dropped = lines.shift() as string;
    total -= estimateTokens(dropped) + 1;
  }
  return lines.join("\n");
}

/** Builds a digest from scratch from the most recent turns (oldest first) — the first run, or a repair after a pipeline-version bump. */
export function buildDigest(turns: readonly DigestTurn[], budgetTokens: number = DIGEST_TOKEN_BUDGET): string | null {
  return updateDigest(null, turns, budgetTokens);
}
