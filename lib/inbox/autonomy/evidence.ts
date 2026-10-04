import "server-only";
import type { Db } from "@/lib/ai/db";
import { evaluateAutonomyPromotion, type PromotionDecision, type PromotionEvidence } from "./promotion";

export interface InboxAutonomyEvidenceResult { evidence: PromotionEvidence; decision: PromotionDecision }

export async function loadInboxAutonomyEvidence(db: Db, agencyId: string, now = new Date()): Promise<InboxAutonomyEvidenceResult> {
  const results = await Promise.all([
    db.from("inbox_autonomy_decisions").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).in("decision", ["SENT", "REJECTED"]),
    db.from("inbox_autonomy_decisions").select("reviewed_at,created_at").eq("agency_id", agencyId).in("decision", ["SENT", "REJECTED"]).order("created_at", { ascending: true }).limit(1),
    db.from("inbox_signal_precision").select("signal_code,reviewed,correct").eq("agency_id", agencyId),
    db.from("inbox_autonomy_decisions").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).eq("decision", "REJECTED"),
    db.from("inbox_autonomy_decisions").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).eq("deny_list_violation", true),
    db.from("ai_surface_settings").select("rejection_demote_threshold").eq("agency_id", agencyId).eq("surface", "INBOX_REPLY").maybeSingle(),
    db.from("inbox_triage_reviews").select("correct").eq("agency_id", agencyId),
  ]);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`Could not load Inbox autonomy evidence: ${failed.error.message}`);
  const [{ count: decisions }, { data: firstRows }, { data: precisionRows }, { count: rejected }, { count: violations }, { data: settings }, { data: triageRows }] = results;
  const rows = (precisionRows ?? []) as Array<{ signal_code: string; reviewed: number; correct: number }>;
  const paymentRows = rows.filter((row) => row.signal_code === "PAYMENT_CLAIM_UNVERIFIED");
  const paymentReviewed = paymentRows.reduce((sum, row) => sum + Number(row.reviewed), 0);
  const paymentCorrect = paymentRows.reduce((sum, row) => sum + Number(row.correct), 0);
  const triage = (triageRows ?? []) as Array<{ correct: boolean }>;
  const firstRow = ((firstRows ?? []) as Array<{ reviewed_at: string | null; created_at: string }>)[0];
  const first = firstRow?.reviewed_at ?? firstRow?.created_at;
  const totalDecisions = decisions ?? 0;
  const evidence: PromotionEvidence = {
    observedDays: first ? Math.floor((now.getTime() - Date.parse(first)) / 86_400_000) : 0,
    decisions: totalDecisions,
    triageAccuracy: triage.length > 0 ? triage.filter((row) => row.correct).length / triage.length : 0,
    paymentClaimPrecision: paymentReviewed > 0 ? paymentCorrect / paymentReviewed : 0,
    denyListViolations: violations ?? 0,
    rejectionRate: totalDecisions > 0 ? (rejected ?? 0) / totalDecisions : 0,
    rejectionThreshold: Number(settings?.rejection_demote_threshold ?? 0.4),
  };
  return { evidence, decision: evaluateAutonomyPromotion(evidence) };
}
