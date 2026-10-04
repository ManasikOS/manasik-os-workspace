import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { toPilgrimListItems } from "@/lib/data/pilgrims";
import { loadPilgrimJourneys } from "@/lib/data/pilgrims-repository";
import { loadAssignedGroupIds } from "@/lib/data/team-repository";
import { createClient } from "@/utils/supabase/server";
import { withTiming } from "@/lib/timing";

import PilgrimsList from "./components/pilgrims-list";
import { PilgrimsProvider } from "./pilgrims-store";

/**
 * Pilgrims list. A Server Component so the clock the readiness/status view
 * models are derived against is decided once and serialised — same reasoning
 * as `app/(main)/leads/page.tsx`.
 *
 * Reads `pilgrim_journey_rows`, the view joining `pilgrims` to their
 * `departure_group_pilgrims` enrolment, booking and departure group (see
 * `supabase/migrations/20260813090000_create_pilgrims.sql`).
 */
export const dynamic = "force-dynamic";

export default async function PilgrimsPage() {
  // Start the queries before the role lookup resolves instead of after it —
  // the role check only decides whether the result may be shown, and RLS still
  // scopes the rows, so a denied user costs one wasted query rather than every
  // user paying a serial round trip. The no-op catch stops a rejection from
  // surfacing as "unhandled" if `notFound()` throws first; awaiting the promise
  // below still rethrows a real failure.
  const supabase = createClient(await cookies());
  const journeysPromise = withTiming("pilgrims.loadJourneys", () => loadPilgrimJourneys(supabase));
  journeysPromise.catch(() => undefined);

  const { role, name, staffId } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.viewModule) notFound();

  const [journeys, assignedGroupIds] = await Promise.all([
    journeysPromise,
    can.assignedGroupOnly && staffId ? loadAssignedGroupIds(supabase, staffId) : Promise.resolve([]),
  ]);
  const nowIso = new Date().toISOString();

  // `staff_group_assignments` scoping, not a name match — see the comment
  // on the equivalent gate in `pilgrims/[pilgrimId]/page.tsx`.
  const assigned = new Set(assignedGroupIds);
  const visibleJourneys = can.assignedGroupOnly
    ? journeys.filter((j) => j.departure_group_id && assigned.has(j.departure_group_id))
    : journeys;

  const pilgrims = toPilgrimListItems(visibleJourneys, nowIso);

  return (
    <PilgrimsProvider pilgrims={pilgrims} nowIso={nowIso} currentStaffName={name} role={role} capabilities={can}>
      <PilgrimsList />
    </PilgrimsProvider>
  );
}
