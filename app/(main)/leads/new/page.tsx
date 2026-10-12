import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { getLeadActor } from "@/lib/data/leads-actor";
import {
  loadAssignableStaff,
  loadLeadStore,
} from "@/lib/data/leads-repository";
import { createClient } from "@/utils/supabase/server";

import LeadEditorScreen from "../components/lead-editor/lead-editor-screen";

/**
 * Adding a lead: the full-page editor (TASK-045).
 *
 * Loads only what the form needs, the packages to pick from and the staff to
 * assign to. No leads are read or sent to the browser; the duplicate check is
 * a narrow server lookup.
 */
export default async function NewLeadPage() {
  // Start the queries before the role lookup resolves instead of after it. RLS
  // still scopes the rows, so a denied user costs one wasted query. The no-op
  // catch stops a rejection surfacing as "unhandled" if `notFound()` throws
  // first; awaiting the promise below still rethrows a real failure.
  const supabase = createClient(await cookies());
  const dataPromise = Promise.all([
    loadLeadStore(supabase, { only: ["packages"] }),
    loadAssignableStaff(supabase),
  ]);
  dataPromise.catch(() => undefined);

  const { staffId, can } = await getLeadActor();
  if (!can.createLead) notFound();

  const [store, staffOptions] = await dataPromise;

  return (
    <LeadEditorScreen
      currentStaffId={staffId ?? ""}
      staffOptions={staffOptions}
      packages={store.packages}
    />
  );
}
