/**
 * Records S0 gate decisions — MI2.3 of docs/inbox/implementation-plan.md. One row per inbound message evaluated, in
 * `inbox_gate_decisions`, which feeds the `inbox_gate_skip_reasons` view and the `s0_skip_rate` KPI (the number the
 * whole cost design is defended by: target 55–70 % of messages exit at S0).
 *
 * Written by the pipeline on the service_role client (the table has no write policy for signed-in sessions), so the
 * agency is passed explicitly. Never throws: a logging failure must not stop a message being processed — it returns
 * false, and the KPI simply misses one row.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import type { GateDecision } from "@/lib/inbox/intelligence/gate";

export async function recordGateDecision(
  db: Db,
  input: { agencyId: string; conversationId: string; messageId?: string | null; decision: GateDecision },
): Promise<boolean> {
  try {
    const { error } = await db.from("inbox_gate_decisions").insert({
      agency_id: input.agencyId,
      conversation_id: input.conversationId,
      message_id: input.messageId ?? null,
      decision: input.decision.enrich ? "ENRICH" : "SKIP",
      reason: input.decision.reason,
      escalate_to_risk: input.decision.escalateToRisk,
    });
    if (error) {
      console.error("recordGateDecision failed (non-fatal):", error.message);
      return false;
    }
    return true;
  } catch (cause) {
    console.error("recordGateDecision failed (non-fatal):", cause);
    return false;
  }
}
