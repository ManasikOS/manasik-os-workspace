import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { loadAssignableStaff, loadLeadStore } from "@/lib/data/leads-repository";
import { listCampaignOptions } from "@/lib/data/campaigns-repository";
import { createClient } from "@/utils/supabase/server";
import { withTiming } from "@/lib/timing";

import LeadsList from "./components/leads-list";
import { LeadsProvider } from "./leads-store";

/**
 * Leads.
 *
 * A Server Component so the loaded store and the clock the view models are
 * derived against are decided once and serialised, rather than each of the
 * server render and the browser calling `new Date()` and disagreeing about
 * which follow-ups are overdue.
 *
 * Backed by Supabase via `lib/data/leads-repository.ts`. Every access
 * decision flows through `getCurrentStaffRole()`, which reads the real
 * `staff_profiles` row for the signed-in user.
 */
export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  // Start the queries before the role lookup resolves instead of after it —
  // the role check only decides whether the result may be shown, and RLS still
  // scopes the rows, so a denied user costs one wasted query rather than every
  // user paying a serial round trip. The no-op catch stops a rejection from
  // surfacing as "unhandled" if `notFound()` throws first; awaiting the promise
  // below still rethrows a real failure.
  const supabase = createClient(await cookies());
  const dataPromise = withTiming("leads.loadData", () =>
    Promise.all([
      loadLeadStore(supabase),
      loadAssignableStaff(supabase),
      listCampaignOptions(supabase).catch(() => []),
    ]),
  );
  dataPromise.catch(() => undefined);

  const { role, name, staffId } = await getCurrentStaffRole();
  const can = capabilitiesForLeads(role);
  if (!can.viewModule) notFound();

  const [store, staffOptions, campaignOptions] = await dataPromise;
  const nowIso = new Date().toISOString();

  // Finance / Operations / Visa only ever see leads that already converted —
  // applied here, before serialisation, so the rest never reaches the client.
  const leads = can.convertedOnly
    ? store.leads.filter((lead) => lead.booking_id !== null)
    : store.leads;

  return (
    <LeadsProvider
      initialStore={{ ...store, leads }}
      nowIso={nowIso}
      currentStaffId={staffId ?? ""}
      currentStaffName={name ?? "Staff"}
      role={role}
      capabilities={can}
      staffOptions={staffOptions}
      campaignOptions={campaignOptions}
    >
      <LeadsList />
    </LeadsProvider>
  );
}
