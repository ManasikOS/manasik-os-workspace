/**
 * Staff verdicts on Copilot signals (MI4.1b). Every read and write names the agency; the write goes through the
 * session client, so the table's RLS (agency + role + "once only") is the backstop and not the only check.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import { summariseSignalPrecision, type SignalPrecisionRow, type SignalPrecisionSummary } from "@/lib/inbox/risk/precision";

export type SignalVerdict = "CORRECT" | "WRONG";

export interface SignalForReview {
  id: string;
  conversationId: string;
  signalCode: string;
  detector: "RULE" | "MODEL";
  confidence: number;
  /** What the customer wrote, exactly as the detector quoted it. */
  snippets: string[];
  createdAt: string;
}

type Row = Record<string, unknown>;

/** The newest signals nobody has judged yet — shadow ones included, which is the point: staff cannot see those in the rail. */
export async function listSignalsForReview(db: Db, agencyId: string, limit = 20): Promise<SignalForReview[]> {
  const { data, error } = await db
    .from("conversation_signals")
    .select("id, conversation_id, signal_code, detector, confidence, evidence, created_at")
    .eq("agency_id", agencyId)
    .is("review_verdict", null)
    // Housekeeping signals carry no judgement worth a human's time.
    .not("signal_code", "in", "(CONCURRENT_COMPOSER,SLA_BREACHED,WINDOW_CLOSING_SOON)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not read signals to review: ${error.message}`);
  return ((data ?? []) as Row[]).map((row) => ({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    signalCode: String(row.signal_code),
    detector: row.detector === "MODEL" ? "MODEL" : "RULE",
    confidence: Number(row.confidence),
    snippets: ((row.evidence ?? []) as Array<{ snippet?: string }>).map((item) => item.snippet ?? "").filter(Boolean),
    createdAt: String(row.created_at),
  }));
}

/** Records one verdict. A signal is judged once: a second attempt (another reviewer's, a double click) is refused, not overwritten. */
export async function recordSignalVerdict(db: Db, input: { agencyId: string; signalId: string; verdict: SignalVerdict; reviewerId: string; now?: Date }): Promise<void> {
  const { data, error } = await db
    .from("conversation_signals")
    .update({ review_verdict: input.verdict, reviewed_by: input.reviewerId, reviewed_at: (input.now ?? new Date()).toISOString() })
    .eq("agency_id", input.agencyId)
    .eq("id", input.signalId)
    .is("review_verdict", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not save the verdict: ${error.message}`);
  if (!data) throw new Error("That signal was already judged, or no longer exists.");
}

export async function loadSignalPrecision(db: Db, agencyId: string): Promise<SignalPrecisionSummary[]> {
  const { data, error } = await db
    .from("inbox_signal_precision")
    .select("signal_code, detector, total_signals, reviewed, correct, wrong")
    .eq("agency_id", agencyId);
  if (error) throw new Error(`Could not read detector precision: ${error.message}`);
  const rows: SignalPrecisionRow[] = ((data ?? []) as Row[]).map((row) => ({
    signalCode: String(row.signal_code),
    detector: row.detector === "MODEL" ? "MODEL" : "RULE",
    totalSignals: Number(row.total_signals),
    reviewed: Number(row.reviewed),
    correct: Number(row.correct),
    wrong: Number(row.wrong),
  }));
  return summariseSignalPrecision(rows);
}
