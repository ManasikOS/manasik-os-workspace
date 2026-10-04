import "server-only";

import type { Db } from "@/lib/ai/db";
import type { ChannelRuntimeAdapter } from "@/lib/channels/adapter";
import { getChannelAdapter } from "@/lib/channels/registry";
import type { ChannelProvider } from "@/lib/inbox/contracts";
import { loadAgencyIsTest } from "@/lib/inbox/outbound/test-agency-send-guard";
import { simulateChannelAdapter } from "@/lib/inbox/simulator/simulated-adapter";

/**
 * The channel adapter to use for one agency: the real one, or the in-memory simulator when the agency is a disposable test agency
 * (`agencies.is_test`). Every code path that reads from or sends to a provider on an agency's behalf takes its adapter from here, so a
 * test agency cannot reach a real provider by accident. Like `getChannelAdapter` it throws "No adapter is installed" first for an unknown
 * provider; and it fails closed: when the flag cannot be read it throws rather than guess.
 */
export async function getChannelAdapterForAgency(db: Db, agencyId: string, provider: ChannelProvider): Promise<ChannelRuntimeAdapter> {
  const base = getChannelAdapter(provider);
  return (await loadAgencyIsTest(db, agencyId)) ? simulateChannelAdapter(base) : base;
}

/**
 * The last check before a provider call: the authorization (read from the database) and the adapter (chosen earlier) must agree on whether
 * this is a test agency. If the flag changed in between, nothing is sent. This is what makes it impossible for a real adapter to be used
 * for a test agency, even through a race.
 */
export function assertSendMatchesAdapter(authorization: { simulated?: boolean }, adapter: { simulated?: true }): void {
  if ((authorization.simulated === true) !== (adapter.simulated === true)) {
    throw new Error("The agency's test status changed during this send, so nothing was sent.");
  }
}
