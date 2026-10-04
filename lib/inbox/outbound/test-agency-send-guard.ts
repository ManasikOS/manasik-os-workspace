import "server-only";

import type { Db } from "@/lib/ai/db";

/** Shown wherever a send is refused because the agency is a disposable test agency. */
export const TEST_AGENCY_SEND_REFUSAL = "This is a test agency. Test agencies never send to real customers.";

/**
 * Whether the agency is a disposable test agency (`agencies.is_test`, TASK-032 S1). Fails closed: a read error or an unknown agency
 * throws instead of answering "not a test agency", because guessing wrong would let a test agency reach a real provider.
 */
export async function loadAgencyIsTest(db: Db, agencyId: string): Promise<boolean> {
  const { data, error } = await db.from("agencies").select("is_test").eq("id", agencyId).maybeSingle();
  if (error) throw new Error(`Could not check whether the agency is a test agency: ${error.message}`);
  if (!data) throw new Error("Could not check whether the agency is a test agency: agency not found.");
  return (data as { is_test: boolean }).is_test === true;
}

/**
 * For the best-effort and result-returning send paths: the refusal text when the agency may not contact a provider, `null` when it may.
 * Never throws; if the flag cannot be read the answer is a refusal, so an uncertain send does not go out.
 */
export async function testAgencySendRefusal(db: Db, agencyId: string): Promise<string | null> {
  try {
    return (await loadAgencyIsTest(db, agencyId)) ? TEST_AGENCY_SEND_REFUSAL : null;
  } catch {
    return "The agency could not be checked, so nothing was sent.";
  }
}
