import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForOperations } from "@/lib/access/operations-access";
import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import { capabilitiesForDocuments } from "@/lib/access/documents-access";
import { capabilitiesForVisa } from "@/lib/access/visa-access";
import { listAllSupportRequests } from "@/lib/data/support-repository";
import { listAllRooms } from "@/lib/data/hotels-repository";
import { buildOperationsSnapshot, getCurrentStaffRole } from "@/lib/data/operations-repository";
import { loadActiveStaffByRole, loadAssignedGroupIds } from "@/lib/data/team-repository";
import { createClient } from "@/utils/supabase/server";
import { listUnacknowledgedConversationHandoffs } from "@/lib/data/conversation-handoff-repository";

import OperationsControlCenter from "./components/operations-control-center";
import { canViewSupportCases, restrictSupportCasesToGroups } from "./support-cases";
import {
  resolveOperationsWorkspaceTab,
  resolveOperationsWorkspaceView,
  type OperationsWorkspaceSearchParams,
} from "./operations-workspace-navigation";
import { OperationsProvider } from "./operations-store";

/**
 * Operations Control Center. A Server Component so every "days to
 * departure" / blocker / readiness derivation is measured against a clock
 * decided once and serialised down — same reasoning as
 * `app/(main)/visa/page.tsx` and `app/(main)/documents/page.tsx`.
 *
 * Unlike Visa and Documents, there is no dedicated database view: the unit
 * of work is `loadStore()` across every group that has not departed, and the
 * snapshot is assembled by reusing `buildBlockers` / `buildSupplierLines` /
 * `scoreReadiness` from `lib/data/departure-groups.ts` so this page can never
 * disagree with the Departure Group detail page about what counts as a
 * blocker. See `lib/data/operations-repository.ts`.
 */
export const dynamic = "force-dynamic";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<OperationsWorkspaceSearchParams>;
}) {
  const query = await searchParams;
  const { role, name, staffId, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForOperations(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const assignedGroupIds =
    role === "GUIDE" && staffId ? await loadAssignedGroupIds(supabase, staffId) : [];
  const tab = resolveOperationsWorkspaceTab(query);
  const isRoomingBoardOpen =
    tab === "accommodation" && resolveOperationsWorkspaceView(tab, query) === "rooming-board";
  const pilgrimCan = capabilitiesForPilgrims(role);
  const canSeeSupportCases = canViewSupportCases(pilgrimCan);
  const [snapshot, guideOptions, handoffs, allSupportCases, allRooms] = await Promise.all([
    buildOperationsSnapshot(supabase, role, assignedGroupIds),
    can.assignGuide ? loadActiveStaffByRole(supabase, "GUIDE") : Promise.resolve([]),
    agencyId && can.acknowledgeInboxHandoff ? listUnacknowledgedConversationHandoffs(supabase, agencyId).catch((cause) => {
      console.error("Could not load unacknowledged conversation handoffs:", cause);
      return [];
    }) : Promise.resolve([]),
    // Fetched only for roles that pass the pilgrim Support tab's own gate, so
    // case detail (which can be medical) never reaches a role without access.
    canSeeSupportCases
      ? listAllSupportRequests(supabase).catch((cause) => {
          console.error("Could not load support cases for Operations:", cause);
          return null;
        })
      : Promise.resolve(null),
    isRoomingBoardOpen
      ? listAllRooms(supabase).catch((cause) => {
          console.error("Could not load the rooming board rooms:", cause);
          return [];
        })
      : Promise.resolve(null),
  ]);
  // Guides only ever see support cases and rooms of the groups they are assigned to.
  const supportCases =
    allSupportCases && (pilgrimCan.assignedGroupOnly || can.assignedGroupOnly)
      ? restrictSupportCasesToGroups(allSupportCases, assignedGroupIds)
      : allSupportCases;
  const roomingBoardRooms =
    allRooms && can.assignedGroupOnly
      ? allRooms.filter((room) => assignedGroupIds.includes(room.departureGroupId))
      : allRooms;

  return (
    <OperationsProvider
      snapshot={snapshot}
      currentStaffName={name}
      role={role}
      can={can}
      guideOptions={guideOptions}
      handoffs={handoffs}
      supportCases={supportCases}
      canManageSupportCases={pilgrimCan.manageSupportRequests}
      canOpenDocuments={capabilitiesForDocuments(role).viewModule}
      canOpenVisa={capabilitiesForVisa(role).viewModule}
      roomingBoardRooms={roomingBoardRooms}
    >
      <OperationsControlCenter />
    </OperationsProvider>
  );
}
