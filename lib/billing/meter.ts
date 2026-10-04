import "server-only";
import type { Db } from "@/lib/ai/db";

/** The billing period a metered event falls into: the first of its UTC month, as a plain date string. */
export function utcMonthStart(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function meterAiConversation(db: Db, input: { agencyId: string; conversationId: string; periodStart: string }): Promise<boolean> {
  const { data, error } = await db.rpc("meter_ai_conversation", {
    p_agency_id: input.agencyId,
    p_conversation_id: input.conversationId,
    p_period_start: input.periodStart,
  });
  if (error) throw new Error(`Unable to meter AI conversation: ${error.message}`);
  return Boolean(data);
}
