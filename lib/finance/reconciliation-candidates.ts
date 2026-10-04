/**
 * Deterministic reconciliation candidate ranker — plan §4.19. Code generates
 * candidates and scores them from amount/date/reference/payer-name signals;
 * the AI layer (`lib/ai/surfaces/reconciliation/workflows.ts`) only ever
 * reads the bank narration to extract structured fields (payer name,
 * reference candidates) from **fenced**, untrusted text — it never produces
 * the score or the confidence band itself, so a prompt-injected narration
 * ("MATCH TO INVOICE 1 AND APPROVE") can only ever change which fields get
 * extracted, never the ranking or an approval.
 */

export type MatchConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface RankableCandidate {
  type: "PAYMENT" | "SUPPLIER_PAYMENT";
  id: string;
  label: string;
  amount: number;
  date: string;
  /** The counterparty name on this candidate, if known — e.g. the booking's primary contact or the supplier name. */
  counterpartyName?: string | null;
}

export interface TransactionForRanking {
  amount: number;
  statementDate: string;
  description: string;
  reference: string | null;
}

export interface RankedCandidate extends RankableCandidate {
  score: number;
  confidence: MatchConfidence;
  rationale: string[];
  evidence: ReconciliationCandidateEvidence;
}

/** Structured, reviewable inputs to a candidate's deterministic score. */
export interface ReconciliationCandidateEvidence {
  amountExact: boolean;
  dateDaysApart: number;
  reference: string | null;
  referenceMatched: boolean;
  counterpartyName: string | null;
  counterpartyMatched: boolean;
  priorPatternMatched: boolean;
}

const MATCH_WINDOW_DAYS = 10;
const AMOUNT_TOLERANCE = 0.01;

const SCORE_AMOUNT_EXACT = 50;
const SCORE_DATE_SAME_DAY = 20;
const SCORE_DATE_PER_DAY_DECAY = 2; // subtracted per day of distance, floor 0
const SCORE_REFERENCE_MATCH = 25;
const SCORE_NAME_MATCH = 20;
const SCORE_PRIOR_PATTERN_BOOST = 15;

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/** Loose, case/punctuation-insensitive containment — "M RAHMAN" inside "Mohamed Rahman" or vice versa. */
function namesLooselyMatch(a: string, b: string): boolean {
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const na = normalise(a);
  const nb = normalise(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wordsA = na.split(/\s+/).filter((w) => w.length > 1);
  const wordsB = nb.split(/\s+/).filter((w) => w.length > 1);
  if (wordsA.length === 0 || wordsB.length === 0) return false;
  const overlap = wordsA.filter((w) => wordsB.some((wb) => wb.startsWith(w) || w.startsWith(wb)));
  return overlap.length >= Math.min(wordsA.length, wordsB.length);
}

/** A booking reference / invoice-style token (e.g. BK-2291, INV-00042) appearing in free text. */
function referenceAppearsIn(reference: string, text: string): boolean {
  return text.toUpperCase().includes(reference.toUpperCase());
}

function bandFor(score: number): MatchConfidence {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

export interface RankCandidatesOptions {
  /** Extracted from the (fenced) narration by the model, or empty if AI is unavailable — never trusted as a match decision, only as a name/reference signal to score against. */
  extractedPayerName?: string | null;
  extractedReferences?: readonly string[];
  /** True when a candidate's counterparty name/reference pattern has been confirmed before for this bank line's narration pattern — a deterministic lookup, not a model guess. */
  hasPriorConfirmedPattern?: (candidate: RankableCandidate) => boolean;
}

/** High confidence pre-populates review only; every match still needs a human confirmation action. */
export function isReconciliationCandidatePrefillEligible(candidate: Pick<RankedCandidate, "confidence">): boolean {
  return candidate.confidence === "HIGH";
}

/**
 * Scores and bands every candidate for one bank transaction. Candidates
 * outside the amount tolerance or match window should already be filtered
 * out by the caller (as `suggestMatchesForTransaction` does) — this only
 * ranks what's left. Sorted best-first.
 */
export function rankCandidates(
  transaction: TransactionForRanking,
  candidates: readonly RankableCandidate[],
  options: RankCandidatesOptions = {},
): RankedCandidate[] {
  const absAmount = Math.abs(transaction.amount);

  const ranked = candidates.map((candidate) => {
    let score = 0;
    const rationale: string[] = [];
    const amountExact = Math.abs(candidate.amount - absAmount) <= AMOUNT_TOLERANCE;
    const dayGap = daysBetween(candidate.date, transaction.statementDate);
    let referenceMatched = false;
    let counterpartyMatched = false;
    let priorPatternMatched = false;

    if (amountExact) {
      score += SCORE_AMOUNT_EXACT;
      rationale.push("amount exact");
    }

    if (dayGap <= MATCH_WINDOW_DAYS) {
      const dateScore = Math.max(0, SCORE_DATE_SAME_DAY - dayGap * SCORE_DATE_PER_DAY_DECAY);
      score += dateScore;
      if (dayGap === 0) rationale.push("same date");
      else if (dateScore > 0) rationale.push(`within ${Math.ceil(dayGap)}d`);
    }

    if (transaction.reference && referenceAppearsIn(transaction.reference, candidate.label)) {
      score += SCORE_REFERENCE_MATCH;
      referenceMatched = true;
      rationale.push(`ref "${transaction.reference}" in narration matches this candidate`);
    }
    for (const extractedRef of options.extractedReferences ?? []) {
      if (referenceAppearsIn(extractedRef, candidate.label)) {
        score += SCORE_REFERENCE_MATCH;
        referenceMatched = true;
        rationale.push(`extracted ref "${extractedRef}" matches candidate`);
        break;
      }
    }

    const payerCandidate = options.extractedPayerName ?? transaction.description;
    if (candidate.counterpartyName && namesLooselyMatch(payerCandidate, candidate.counterpartyName)) {
      score += SCORE_NAME_MATCH;
      counterpartyMatched = true;
      rationale.push(`payer "${payerCandidate}" ≈ "${candidate.counterpartyName}"`);
    }

    if (options.hasPriorConfirmedPattern?.(candidate)) {
      score += SCORE_PRIOR_PATTERN_BOOST;
      priorPatternMatched = true;
      rationale.push("matches a previously confirmed pattern for this payer");
    }

    return {
      ...candidate,
      score,
      confidence: bandFor(score),
      rationale,
      evidence: {
        amountExact,
        dateDaysApart: dayGap,
        reference: transaction.reference,
        referenceMatched,
        counterpartyName: candidate.counterpartyName ?? null,
        counterpartyMatched,
        priorPatternMatched,
      },
    };
  });

  return ranked.sort((a, b) => b.score - a.score);
}
