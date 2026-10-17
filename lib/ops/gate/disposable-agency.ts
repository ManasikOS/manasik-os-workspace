import { deliverSignedWebhook, whatsappTextMessage } from "../../inbox/simulator/inbound-payloads";
import type { GateCheckResult, GateContext } from "./types";

/**
 * G9, the disposable-agency acceptance check (TASK-032 W7). It proves, on the deployment being judged, the path every real customer message takes:
 * a signed webhook for a connected number reaches the right agency, a Meta redelivery of the same event is kept once, a forged event is refused,
 * and the whole test agency can be removed with nothing left behind.
 *
 * Everything runs through `DisposableAgencyPort`, so the check is tested without a database or a network. The CLI supplies a port backed by the
 * service-role client; see scripts/gate/run.ts.
 *
 * Safety:
 *  - The agency is flagged `is_test`, so the send guard (lib/inbox/outbound/authorize-provider-send.ts) can never let it reach a real provider.
 *  - The connected number is `sim-gate-…` and the payload builders refuse any account id that does not start with `sim`, so a real customer's
 *    number or Page can never be addressed.
 *  - The agency is removed in a `finally`, whatever happened, and agencies left by an earlier crashed run are removed first.
 *  - Details carry names and counts only; the app secret is never printed.
 */

export const DISPOSABLE_AGENCY_SLUG_PREFIX = "e2e-gate-";
/** A leftover from a crashed run is removed only once it is this old, so two runs overlapping never delete each other's agency. */
export const STALE_AGENCY_MS = 60 * 60 * 1000;

export interface InboundCounts {
  /** Stored webhook events that name this agency (a duplicate must not add a second). */
  events: number;
  conversations: number;
  customerMessages: number;
}

export interface DisposableAgencyPort {
  /** Creates the test agency and its simulated WhatsApp connection. Throws when it cannot. */
  create(input: { slug: string; name: string; phoneNumberId: string }): Promise<{ agencyId: string }>;
  countInbound(agencyId: string): Promise<InboundCounts>;
  /** Removes the agency (and, through the cascade, everything that names it). Throws when it cannot. */
  remove(agencyId: string): Promise<void>;
  /** Tables, and storage, that still hold rows naming the agency after removal. An empty list means nothing was left behind. */
  leftovers(agencyId: string): Promise<Array<{ table: string; rows: number }>>;
  /** Test agencies from earlier runs (slug starting `e2e-gate-`) created before the given time. */
  findStale(olderThan: Date): Promise<string[]>;
}

const TITLE = "Disposable-agency acceptance";
const FORGED_SIGNATURE = `sha256=${"0".repeat(64)}`;

function result(status: GateCheckResult["status"], detail: string, items?: string[]): GateCheckResult {
  return { id: "G9", title: TITLE, status, detail, ...(items && items.length > 0 ? { items } : {}) };
}

function describeFailure(cause: unknown): string {
  return cause instanceof Error ? cause.message.slice(0, 160) : "unknown error";
}

export async function checkDisposableAgency(context: GateContext): Promise<GateCheckResult> {
  const port = context.disposableAgency;
  if (!port) return result("PENDING", "No database access was supplied for the disposable agency, so the acceptance check did not run.");
  if (!context.metaAppSecret) {
    return result("PENDING", "Not run: set GATE_META_APP_SECRET to the deployment's platform Meta app secret so the check can sign a webhook the way Meta does.");
  }
  const appSecret = context.metaAppSecret;
  const now = context.now ?? new Date();
  const stamp = now.getTime().toString(36);
  const slug = `${DISPOSABLE_AGENCY_SLUG_PREFIX}${stamp}`;
  const phoneNumberId = `sim-gate-${stamp}`;
  const fetchImpl = context.fetchImpl;
  const problems: string[] = [];

  // A crashed earlier run must not leave test data behind forever. Failure to tidy it is reported, never ignored.
  try {
    for (const staleId of await port.findStale(new Date(now.getTime() - STALE_AGENCY_MS))) {
      try {
        await port.remove(staleId);
      } catch (cause) {
        problems.push(`could not remove an older test agency (${staleId}): ${describeFailure(cause)}`);
      }
    }
  } catch (cause) {
    problems.push(`could not look for older test agencies: ${describeFailure(cause)}`);
  }

  let agencyId: string;
  try {
    agencyId = (await port.create({ slug, name: `E2E-GATE-${stamp}`, phoneNumberId })).agencyId;
  } catch (cause) {
    return result("FAIL", `The test agency could not be created: ${describeFailure(cause)}.`, problems);
  }

  try {
    const payload = whatsappTextMessage({ phoneNumberId }, { from: "10000000001", text: "gate acceptance", name: "Gate Customer", messageId: `wamid.gate.${stamp}` });
    const options = { baseUrl: context.baseUrl, channel: "WHATSAPP" as const, payload, appSecret, fetchImpl };

    const first = await deliverSignedWebhook(options);
    if (first.status !== 200) problems.push(`a correctly signed event was answered ${first.status}, expected 200`);
    const second = await deliverSignedWebhook(options);
    if (second.status !== 200) problems.push(`the same event delivered again was answered ${second.status}, expected 200`);
    else if (!second.body.includes("duplicate")) problems.push("the same event delivered again was not recognised as a duplicate");

    const forged = await deliverSignedWebhook({ ...options, signatureOverride: FORGED_SIGNATURE });
    if (forged.status !== 401) problems.push(`an event with a forged signature was answered ${forged.status}, expected 401`);

    const counts = await port.countInbound(agencyId);
    if (counts.events !== 1) problems.push(`${counts.events} webhook events were stored for the event and its duplicate, expected exactly 1`);
    if (counts.conversations !== 1) problems.push(`${counts.conversations} conversations exist for the test customer, expected 1`);
    if (counts.customerMessages !== 1) problems.push(`${counts.customerMessages} customer messages were stored, expected exactly 1`);
  } catch (cause) {
    problems.push(`the acceptance steps could not complete: ${describeFailure(cause)}`);
  } finally {
    try {
      await port.remove(agencyId);
      const left = await port.leftovers(agencyId);
      if (left.length > 0) problems.push(...left.map((entry) => `after removal, ${entry.table} still holds ${entry.rows} row(s) for the test agency`));
    } catch (cause) {
      problems.push(`the test agency ${agencyId} could not be removed; remove it by hand: ${describeFailure(cause)}`);
    }
  }

  if (problems.length > 0) return result("FAIL", `${problems.length} problem(s).`, problems);
  return result("PASS", "A signed event reached its agency once, its duplicate was kept once, a forged event was refused, and the test agency was removed with nothing left behind.");
}
