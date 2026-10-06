/**
 * Read/write access for Departure Groups.
 *
 * Every screen goes through this module: components receive finished view
 * models, never rows. Rows come from Supabase — reads hydrate exactly the slice
 * a screen needs through `departure-groups-repository`, and writes run the pure
 * mutators against that slice and flush the difference back.
 *
 * Two invariants are enforced here rather than in the UI:
 *   * Readiness score and status are DERIVED from the live checklist, so a
 *     stale `readiness_score` column can never disagree with what the Readiness
 *     tab shows.
 *   * Supplier costs and finance figures are stripped for roles without the
 *     capability — the data is not fetched-then-hidden, it is nulled before it
 *     leaves this module.
 */

import { cookies } from "next/headers";
import { cache } from "react";

import { colomboDayKey } from "@/lib/date";
import { loadAssignedGroupIds } from "@/lib/data/team-repository";
import { verifyStoredTravellerFile } from "@/lib/data/departure-groups-uploads";

import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import {
  canRoleActOnGroup,
  capabilitiesFor,
  type DepartureGroupCapabilities,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import {
  DEFAULT_COPY_OPTIONS,
  buildAccommodations,
  buildFlights,
  buildGroupCostEstimate,
  buildGroupPricing,
  buildPackageSnapshot,
  buildReadinessItems,
  buildTransports,
  daysBetween,
  dueLabelFor,
  isUuid,
  type PackageTemplateDefinition,
} from "@/lib/data/departure-groups-copy";
import {
  loadTemplateDefinition,
  parseSeatHoldHours,
} from "@/lib/data/packages-template";
import {
  addTravellerRelationshipInStore,
  cancelGroupBookingInStore,
  changeBookingRoomPreferenceInStore,
  createGroupBookingInStore,
  isTravellingPilgrim,
  moveBookingToGroupInStore,
  promoteWaitlistBookingInStore,
  recordBookingPaymentInStore,
  releaseExpiredSeatHoldsInStore,
  removeTravellerRelationshipInStore,
  reverseBookingPaymentInStore,
  sendBookingReminderInStore,
  setBookingPayerInStore,
  updateBookingContactInStore,
  validateBookingRequest,
  type AddTravellerRelationshipInput,
  type AddTravellerRelationshipOutcome,
  type CancelBookingInput,
  type PromoteWaitlistOutcome,
  type ReleaseExpiredHoldsResult,
  type CancelBookingOutcome,
  type ChangeRoomPreferenceInput,
  type ChangeRoomPreferenceOutcome,
  type CreateBookingOutcome,
  type EditBookingInput,
  type EditBookingOutcome,
  type MoveBookingInput,
  type MoveBookingOutcome,
  type RecordPaymentInput,
  type RecordPaymentOutcome,
  type RemoveTravellerRelationshipInput,
  type RemoveTravellerRelationshipOutcome,
  type ReverseBookingPaymentInput,
  type ReverseBookingPaymentOutcome,
  type SendBookingReminderInput,
  type SendBookingReminderOutcome,
  type SetBookingPayerInput,
  type SetBookingPayerOutcome,
} from "@/lib/data/departure-groups-bookings";
import {
  addChargeInStore,
  approveChargeInStore,
  setBaseFareInStore,
  voidChargeInStore,
  type AddChargeInput,
  type ApproveChargeInput,
  type ChargeMutationOutcome,
  type SetBaseFareInput,
  type VoidChargeInput,
} from "@/lib/data/departure-groups-charges";
import {
  cancelDeviationInStore,
  decideDeviationInStore,
  markDeviationArrangedInStore,
  requestDeviationInStore,
  type CancelDeviationInput,
  type DecideDeviationInput,
  type DeviationMutationOutcome,
  type MarkDeviationArrangedInput,
  type RequestDeviationInput,
} from "@/lib/data/departure-groups-deviations";
import { groupPrice, sumChargeLines } from "@/lib/data/departure-groups-money";
import {
  analyseTicket,
  analyseVisa,
  extractedPnr,
  extractTicketIdentity,
  isTicketVisaAiConfigured,
  matchExtractedNameToPilgrims,
  pnrMismatchIssue,
  type TicketVisaAiOutcome,
} from "@/lib/data/ticket-visa-ai";
import {
  extractTicketIdentityFromPdf,
  locationAppears,
} from "@/lib/data/ticket-pdf-extraction";
import {
  addFlightLegInStore,
  flagPilgrimFlightIssueInStore,
  markFlightTicketsIssuedInStore,
  recordFlightTicketingInStore,
  recordTicketAiResultInStore,
  recordTicketUploadInStore,
  removeFlightLegInStore,
  updateFlightLegInStore,
  upsertFlightInStore,
  upsertFlightWithLegsInStore,
  type AddFlightLegInput,
  type UpsertFlightWithLegsInput,
  type FlagPilgrimFlightIssueInput,
  type FlagPilgrimFlightIssueOutcome,
  type AddFlightLegOutcome,
  type FlightTicketingInput,
  type FlightTicketingOutcome,
  type MarkFlightTicketsIssuedInput,
  type MarkFlightTicketsIssuedOutcome,
  type RecordTicketUploadInput,
  type RecordTicketUploadOutcome,
  type RemoveFlightLegInput,
  type RemoveFlightLegOutcome,
  type UpdateFlightLegInput,
  type UpdateFlightLegOutcome,
  type UpsertFlightInput,
  type UpsertFlightOutcome,
} from "@/lib/data/departure-groups-flights";
import {
  assignPilgrimToRoomInStore,
  autoAssignRoomsInStore,
  createAccommodationInStore,
  deleteRoomInStore,
  generateRoomsInStore,
  markAccommodationConfirmedInStore,
  setAccommodationInternalCostInStore,
  setAccommodationReferenceInStore,
  setAccommodationVoucherInStore,
  unlockPilgrimRoomAssignmentInStore,
  updateAccommodationInStore,
  updateRoomInStore,
  type AccommodationTouchOutcome,
  type AssignRoomInput,
  type AssignRoomOutcome,
  type AutoAssignRoomsInput,
  type AutoAssignRoomsOutcome,
  type CreateAccommodationInput,
  type CreateAccommodationOutcome,
  type DeleteRoomInput,
  type DeleteRoomOutcome,
  type GenerateRoomsInput,
  type GenerateRoomsOutcome,
  type UnlockRoomAssignmentInput,
  type UnlockRoomAssignmentOutcome,
  type UpdateAccommodationInput,
  type UpdateAccommodationOutcome,
  type UpdateRoomInput,
  type UpdateRoomOutcome,
} from "@/lib/data/departure-groups-rooming";
import {
  markTransportConfirmedInStore,
  setTransportConfirmationInStore,
  setTransportInternalCostInStore,
  setTransportReferenceInStore,
  upsertTransportInStore,
  type TransportTouchOutcome,
  type UpsertTransportInput,
  type UpsertTransportOutcome,
} from "@/lib/data/departure-groups-transport";
import {
  checkPassportValidity,
  markApplicationsSubmittedInStore,
  markVisaUnderReviewInStore,
  recordVisaAiResultInStore,
  rejectPilgrimDocumentInStore,
  rejectPilgrimVisaInStore,
  submitPilgrimDocumentInStore,
  syncGroupDerivedState,
  updatePilgrimRecordInStore,
  uploadPilgrimVisaInStore,
  verifyPilgrimDocumentInStore,
  waivePilgrimDocumentInStore,
  type DocumentOutcome,
  type MarkApplicationsSubmittedOutcome,
  type RejectDocumentInput,
  type RejectVisaInput,
  type SubmitDocumentInput,
  type UpdatePilgrimRecordInput,
  type UpdatePilgrimRecordOutcome,
  type UploadVisaInput,
  type VerifyDocumentInput,
  type VisaDecisionOutcome,
  type WaiveDocumentInput,
} from "@/lib/data/departure-groups-documents";
import {
  setGroupLifecycleInStore,
  updateGroupDetailsInStore,
  type GroupLifecycleAction,
  type GroupLifecycleOutcome,
  type UpdateGroupDetailsInput,
  type UpdateGroupDetailsOutcome,
} from "@/lib/data/departure-groups-lifecycle";
import {
  AUTO_SOURCE_HINTS,
  deriveReadinessStatuses,
  updateReadinessItemInStore,
  type UpdateReadinessItemInput,
  type UpdateReadinessItemOutcome,
} from "@/lib/data/departure-groups-readiness";
import {
  bulkUpdateGroupTasksInStore,
  createGroupTaskInStore,
  reassignGroupTaskInStore,
  updateGroupTaskStatusInStore,
  type BulkUpdateGroupTasksInput,
  type BulkUpdateGroupTasksOutcome,
  type CreateGroupTaskInput,
  type CreateGroupTaskOutcome,
  type ReassignGroupTaskInput,
  type ReassignGroupTaskOutcome,
  type UpdateGroupTaskStatusOutcome,
} from "@/lib/data/departure-groups-tasks";
import { newId } from "@/lib/data/departure-groups-ids";
import {
  concurrencyConflictMessage,
  DeparturePartialWriteError,
  emptyStore,
  loadStore,
  persistStore,
  persistStoreAtomic,
  snapshotStore,
  type Db,
} from "@/lib/data/departure-groups-repository";
import { getSessionUser } from "@/lib/dal";
import { withTiming } from "@/lib/timing";
import { computeListStepGaps, listCompletenessPercent } from "@/lib/validations/packages";
import type { PackageRow } from "@/lib/types/database";
import type {
  AccommodationCity,
  AiReviewIssue,
  DepartureGroupAccommodationRow,
  DepartureGroupActivityLogRow,
  DepartureGroupFlightRow,
  DepartureGroupPackageSnapshotRow,
  DepartureGroupPricingRow,
  DepartureGroupCostingRow,
  DepartureGroupPilgrimRow,
  DepartureGroupReadinessItemRow,
  DepartureGroupRow,
  DepartureGroupStore,
  DepartureGroupTaskRow,
  DepartureGroupPilgrimChargeRow,
  DepartureGroupPilgrimDeviationRow,
  GroupActor,
  GroupJourneyType,
  ReadinessCategory,
  ReadinessItemStatus,
  RoomType,
  TaskStatus,
} from "@/lib/types/departure-groups";
import { createClient } from "@/utils/supabase/server";
import type {
  CreateDepartureGroupInput,
  CreateGroupBookingInput,
  DepartureGroupAccommodation,
  DepartureGroupBlocker,
  DepartureGroupBooking,
  DepartureGroupDetail,
  DepartureGroupFlight,
  DepartureGroupListItem,
  DepartureGroupManifestRow,
  DepartureGroupOverview,
  DepartureGroupPackageSnapshot,
  DepartureGroupPricing,
  DepartureGroupCosting,
  DepartureGroupPaymentSummary,
  DepartureGroupReadinessItem,
  DepartureGroupReadinessSummary,
  DepartureGroupTask,
  DepartureGroupTransport,
  GroupActivityLog,
  MoveTargetGroupOption,
  PackageTemplateOption,
  PilgrimCharge,
  PilgrimDeviation,
  ReadinessCategoryProgress,
  SupplierStatusLine,
} from "@/app/(main)/departure-groups/types";

/* ── Backing store ────────────────────────────────────────────────────────── */

/**
 * Every collection a mutation may read or write. The activity trail is left out
 * deliberately: mutators only ever append to it, and loading a group's whole
 * history to add one row would be pure waste — `persistStore` treats an empty
 * "before" trail as "insert what the mutator pushed".
 */
const MUTABLE_COLLECTIONS = [
  "groups",
  "snapshots",
  "pricing",
  "costEstimates",
  "flights",
  "flightLegs",
  "accommodations",
  "rooms",
  "roomAssignments",
  "transports",
  "bookings",
  "pilgrims",
  "pilgrimDocuments",
  "pilgrimCharges",
  "pilgrimDeviations",
  "readinessItems",
  "tasks",
] as const;

/**
 * Everything the list screen needs, and nothing it does not.
 *
 * Flights and transports are here because the derived readiness items read them
 * — the list's readiness badge is now computed from the same rows the detail
 * page shows, rather than from a checklist that could disagree with both.
 */
const LIST_COLLECTIONS = [
  "groups",
  "snapshots",
  "pricing",
  "readinessItems",
  "pilgrims",
  "accommodations",
  "transports",
  "flights",
  "bookings",
] as const;

/**
 * `client` lets a caller with no browser session — the WhatsApp webhook, the
 * agent job worker, the cron drain — supply the service-role admin client
 * instead of the session-cookie client this function otherwise builds. See
 * docs/modules/whatsapp-ai-agent-implementation-plan.md F3.
 */
async function db(client?: Db): Promise<Db> {
  if (client) return client;
  return createClient(await cookies());
}

/* ── Current staff role ───────────────────────────────────────────────────── */

/**
 * The role floor for anyone with no usable `staff_profiles` row: no row at
 * all, an account that isn't `ACTIVE`, or a seasonal access window that has
 * closed. `GUIDE` is the most restricted role in every capability matrix —
 * `{ ...NONE }` in most modules — so it is the safe default rather than a
 * cliff that 500s the page.
 */
const DENIED_ROLE: StaffRole = "GUIDE";

const KNOWN_ROLES: StaffRole[] = [
  "ADMIN",
  "CEO",
  "FINANCE",
  "MARKETING",
  "OPERATIONS",
  "VISA",
  "GUIDE",
];

/**
 * Resolves the signed-in user's role from `staff_profiles`.
 *
 * Every access decision in the app flows through here — see
 * `lib/access/*-access.ts`. A missing row, a non-`ACTIVE` status, or an
 * expired seasonal `access_ends_on` all resolve to the same denied floor
 * rather than a thrown error, so a page can still render its "you don't have
 * access" state instead of crashing.
 */
/** One agency a signed-in user can switch into — see `lib/tenancy.ts`. */
export interface AgencyMembership {
  agencyId: string;
  agencyName: string;
  role: StaffRole;
  isDefault: boolean;
}

const loadCurrentStaffRole = async (): Promise<{
    role: StaffRole;
    name: string | null;
    staffId: string | null;
    /** Tenant id from staff_profiles.agency_id — null whenever staffId is null. */
    agencyId: string | null;
    /**
     * `staff_profiles.role_id` — the dynamic role assignment behind the
     * Roles & Permissions system (supabase/migrations/20260924090000). Null
     * for an account that predates that migration's backfill, or one with
     * no usable profile at all. `role` above stays the RLS-recognised text
     * tier and is unaffected by this; `roleId` is only for looking up
     * `role_permissions` for app-layer capability checks.
     */
    roleId: string | null;
    /**
     * True only when the profile and role resolved fine but the active
     * agency itself is SUSPENDED or CANCELLED (F7) — distinct from "no
     * profile at all" so the layout can render a dedicated "workspace
     * suspended" screen instead of the ordinary permission-denied panels.
     */
    agencySuspended: boolean;
    /** Every agency this person is an active member of, for the switcher. */
    memberships: AgencyMembership[];
    /**
     * The profile's account status and last-active stamp, present even for a
     * denied (e.g. INVITED) account — the layout hands it to
     * `touchSessionActivity()` so that does not have to re-select the row.
     * Null when there is no profile at all.
     */
    activity: { status: string | null; lastActiveAt: string | null } | null;
  }> => {
    const empty = { role: DENIED_ROLE, name: null, staffId: null, agencyId: null, roleId: null, agencySuspended: false, memberships: [], activity: null };

    const user = await getSessionUser();
    if (!user) {
      return empty;
    }

    const supabase = await db();
    const [profileResult, { data: memberRows }] = await Promise.all([
      supabase
        .from("staff_profiles")
        .select("role, role_id, full_name, status, last_active_at, access_starts_on, access_ends_on, agency_id, agencies(status)")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("agency_members")
        .select("agency_id, role, is_default, agencies(name, status)")
        .eq("user_id", user.id)
        .eq("status", "ACTIVE"),
    ]);

    let profile = profileResult.data;
    // `role_id` (supabase/migrations/20260924090000_dynamic_roles_permissions.sql)
    // may not be selectable yet, for either of two reasons: the migration
    // hasn't been applied at all (raw Postgres "undefined_column", 42703),
    // or it has but Supabase's PostgREST layer hasn't reloaded its schema
    // cache to notice the new column yet ("PGRST205" — expected right after
    // a migration is pasted into the SQL Editor by hand, since that doesn't
    // auto-notify PostgREST the way Supabase's own migration tooling does).
    // Either way Postgres/PostgREST errors the WHOLE select rather than just
    // omitting the one unknown column, which would otherwise make `profile`
    // null and deny every role, everywhere, for everyone. Falling back to
    // the pre-migration column list keeps this function working exactly as
    // it always has until the column is actually reachable.
    if (!profile && (profileResult.error?.code === "42703" || profileResult.error?.code === "PGRST205")) {
      const fallback = await supabase
        .from("staff_profiles")
        .select("role, full_name, status, last_active_at, access_starts_on, access_ends_on, agency_id, agencies(status)")
        .eq("id", user.id)
        .maybeSingle();
      profile = fallback.data as typeof profile;
    }

    const name = profile?.full_name || user.email || null;

    const memberships: AgencyMembership[] = ((memberRows ?? []) as unknown as {
      agency_id: string;
      role: string;
      is_default: boolean;
      agencies: { name: string; status: string } | null;
    }[])
      .filter((m) => m.agencies?.status === "ACTIVE")
      .map((m) => ({
        agencyId: m.agency_id,
        agencyName: m.agencies?.name ?? "",
        role: KNOWN_ROLES.includes(m.role?.toUpperCase() as StaffRole)
          ? (m.role.toUpperCase() as StaffRole)
          : DENIED_ROLE,
        isDefault: m.is_default,
      }));

    if (!profile) {
      return { ...empty, name, memberships };
    }

    const activity = {
      status: (profile.status as string | null) ?? null,
      lastActiveAt: (profile as { last_active_at?: string | null }).last_active_at ?? null,
    };

    const agencyStatus = (profile as { agencies?: { status?: string } | null }).agencies?.status ?? null;
    if (agencyStatus !== null && agencyStatus !== "ACTIVE") {
      return { role: DENIED_ROLE, name, staffId: null, agencyId: null, roleId: null, agencySuspended: true, memberships, activity };
    }

    const isExpired =
      profile.access_ends_on !== null &&
      profile.access_ends_on < colomboDayKey();

    // H5 of docs/modules/team-module-remediation-plan.md: only `access_ends_on` was
    // enforced here — someone invited with a future `access_starts_on`
    // could sign in immediately, before their access window opened.
    const isNotYetStarted =
      profile.access_starts_on !== null &&
      profile.access_starts_on > colomboDayKey();

    if (profile.status !== "ACTIVE" || isExpired || isNotYetStarted) {
      return { role: DENIED_ROLE, name, staffId: null, agencyId: null, roleId: null, agencySuspended: false, memberships, activity };
    }

    const role = profile.role?.toUpperCase();
    return {
      role: KNOWN_ROLES.includes(role as StaffRole) ? (role as StaffRole) : DENIED_ROLE,
      name,
      staffId: user.id,
      agencyId: (profile as { agency_id?: string }).agency_id ?? null,
      roleId: (profile as { role_id?: string | null }).role_id ?? null,
      agencySuspended: false,
      memberships,
      activity,
    };
  };

/** One lookup per request (React `cache`), timed when `PERF_TIMING=1`. */
export const getCurrentStaffRole = cache(() => withTiming("getCurrentStaffRole", loadCurrentStaffRole));

/**
 * The signed-in person's Departure Groups capabilities: their base role's
 * built-in set, with any custom-role overrides saved in `role_permissions`
 * merged over it — the same resolution every other module already uses (see
 * `lib/access/dynamic-capabilities.ts`). Every server-side check in this
 * module should read this, not `capabilitiesFor(role)` directly, or a custom
 * role's saved permissions silently do nothing. One lookup per request.
 */
export const getCurrentDepartureCapabilities = cache(
  async (): Promise<DepartureGroupCapabilities> => {
    const { role, roleId } = await getCurrentStaffRole();
    const supabase = createClient(await cookies());
    return loadDynamicCapabilities(
      supabase,
      roleId,
      "departure_groups",
      capabilitiesFor(role),
    );
  },
);

/**
 * The acting staff member, for the audit columns.
 *
 * `actor_id`, `completed_by` and `assigned_by` are foreign keys into
 * `auth.users`, so they get the real user id; the name travels alongside so the
 * activity trail stays readable if that account is ever removed.
 */
const currentActor = cache(async (): Promise<GroupActor> => {
  const [user, { name, agencyId }] = await Promise.all([getSessionUser(), getCurrentStaffRole()]);
  return { id: user?.id ?? null, name: name ?? "Staff", agencyId };
});

/* ── Unit of work ─────────────────────────────────────────────────────────── */

/**
 * Whether every mutation is written through the version-aware database function
 * (`apply_departure_store_changes_atomic_v2`) instead of one table at a time.
 * Set `DEPARTURE_ATOMIC_PERSIST=all` only after migration
 * `20270116090000_departure_store_atomic_rpc_v2.sql` is applied; with it unset
 * nothing changes.
 */
function atomicEverywhere(): boolean {
  return process.env.DEPARTURE_ATOMIC_PERSIST === "all";
}

/** Verifies an attached traveller file's real bytes before it is recorded against anyone. */
async function checkAttachedFile(filePath: string | null | undefined) {
  const path = filePath?.trim();
  if (!path) return { ok: true as const };
  return verifyStoredTravellerFile(await db(), path);
}

async function refuseUnscopedGroups(
  supabase: Db,
  store: DepartureGroupStore,
  groupIds: string[],
): Promise<string | null> {
  if (groupIds.length === 0) return null;
  const { role, staffId } = await getCurrentStaffRole();
  if (role !== "GUIDE" && role !== "MARKETING") return null;

  const assignedGroupIds =
    role === "GUIDE" && staffId ? await loadAssignedGroupIds(supabase, staffId) : [];
  for (const groupId of groupIds) {
    const group = store.groups.find((row) => row.id === groupId);
    // A missing group is the mutator's own "no longer exists" error.
    if (group && !canRoleActOnGroup(group, role, assignedGroupIds)) {
      return "You do not have access to that departure group.";
    }
  }
  return null;
}

/**
 * Runs one mutation against the database.
 *
 * Loads the groups the mutation touches, hands the resulting store to the pure
 * mutator, then writes back only the rows that actually changed. The pure
 * mutators are unchanged from when they ran against the in-memory seed — the
 * capacity gates, seat reconciliation and rooming releases they encode are the
 * same rules, now durable.
 *
 * A failed outcome writes nothing: the mutators validate before they mutate, so
 * an `ok: false` store is byte-identical to the one that was loaded and the
 * diff is empty. `skipPersistOnFailure` makes that explicit rather than relying
 * on it.
 *
 * Exported for `lib/agent/kernel/proposals/executors/*` (Phase 3 of
 * docs/modules/departure-operations-agent-implementation-plan.md, D4): every proposal
 * executor's `execute()` calls exactly this function with the *approving
 * human's* actor and the session client — never the agent's — so a
 * proposal's execution is byte-for-byte the same write a manual click makes.
 * `loadStore` runs fresh inside this call, which is also what makes it the
 * re-validation D6 asks for: a mutator that finds its precondition no longer
 * holds (a hotel someone else already confirmed, a deviation already
 * decided) fails exactly as it would for a human, because it is reading the
 * same live state a human's click would read.
 */
export async function mutate<T extends { ok: boolean }>(
  groupIds: string[],
  run: (store: DepartureGroupStore, actor: GroupActor) => T,
  options?: {
    /** Admin client for callers with no session (the WhatsApp agent) — see F3/D8 in the plan. */
    client?: Db;
    /** Skips currentActor()'s session lookup, which resolves to nothing outside a session. */
    actor?: GroupActor;
    /** Uses the tenant-checked Postgres diff RPC for all-or-nothing writes. */
    atomic?: boolean;
  },
): Promise<T> {
  const supabase = await db(options?.client);
  const actor = options?.actor ?? (await currentActor());

  // Scoped to the actor's agency IN THE QUERY, on top of row-level security: a session client is already filtered by RLS, but
  // the agent, proposal executors and WhatsApp tools run on the service-role client, which RLS does not filter, and a group id
  // that belongs to another agency must simply not load for any of them. (The seat-hold sweeper has no single agency and
  // passes none; it selects its own group ids.)
  const store = await loadStore(supabase, {
    groupIds,
    only: MUTABLE_COLLECTIONS,
    includeArchived: true,
    agencyId: actor.agencyId ?? undefined,
  });
  const before = snapshotStore(store);

  // A signed-in person's write, as opposed to the agent or a cron sweep (which
  // pass their own client/actor and are scoped by their callers): the role must
  // be allowed to act on every group this mutation touches. The pages already
  // refuse these groups with notFound(), but a Server Action is a public POST
  // endpoint and takes the group id from the client.
  if (!options?.client && !options?.actor) {
    const refusal = await refuseUnscopedGroups(supabase, store, groupIds);
    if (refusal) return { ok: false, error: refusal } as unknown as T;
  }

  const outcome = run(store, actor);
  if (!outcome.ok) return outcome;

  // The score is derived from the checklist on every read; writing it here as
  // well keeps the stored column — and the indexes and AI queries that filter
  // on it — agreeing with what the Readiness tab shows.
  syncDerivedColumns(store);

  try {
    if (options?.atomic) {
      await persistStoreAtomic(supabase, before, store, actor.agencyId, atomicEverywhere() ? "v2" : "v1");
    } else if (atomicEverywhere() && actor.agencyId) {
      // Every mutation in one transaction, with the booking row-version guard.
      // Off until the v2 function has been applied and checked against a real
      // database (see TASK-037, SEC-11). A caller with no single agency (the
      // seat-hold sweeper) cannot use it and keeps the row-by-row path.
      await persistStoreAtomic(supabase, before, store, actor.agencyId, "v2");
    } else {
      await persistStore(supabase, before, store, actor.agencyId);
    }
  } catch (error) {
    // A capacity or uniqueness backstop constraint firing here means two
    // writers passed the application's own check at the same instant — not
    // a bug, just the race the constraint exists to catch. Surface it as an
    // ordinary, retryable outcome instead of an unhandled exception; anything
    // else still throws, since that IS a bug.
    const conflict = concurrencyConflictMessage(error);
    if (conflict) return { ok: false, error: conflict } as unknown as T;

    if (error instanceof DeparturePartialWriteError) {
      // Not retryable and not a bug to silently swallow: some collections
      // are now durably written and the rest are not. This is the gap a
      // real database transaction would close (see the class comment) —
      // until that exists, the loudest possible signal is the correct
      // response, so an operator can reconcile the affected group(s) by
      // hand rather than this failing quietly inside a Server Action.
      console.error(
        `[departure-groups] PARTIAL WRITE for group(s) ${groupIds.join(", ")}: ${error.message}`,
      );
    }
    throw error;
  }
  return outcome;
}

/**
 * Brings every derived field on the loaded groups up to date.
 *
 * Order matters. The document counters feed the derived readiness items
 * (`DOCUMENTS_ALL_VERIFIED`, `VISAS_ALL_APPROVED`), the readiness items feed the
 * score, and the score feeds the column the list screen and the AI queries
 * filter on. Running it as one pass after every mutation is what stops the
 * three from ever disagreeing — which is the failure the Readiness tab and the
 * Overview used to exhibit against each other.
 */
function syncDerivedColumns(store: DepartureGroupStore): void {
  for (const group of store.groups) {
    syncGroupDerivedState(store, group.id);
    deriveReadinessStatuses(store, group.id);

    const summary = scoreReadiness(
      store.readinessItems.filter(
        (item) => item.departure_group_id === group.id,
      ),
    );
    group.readiness_score = summary.score;
    group.readiness_status = summary.status;
  }
}

/* ── Readiness scoring ────────────────────────────────────────────────────── */

/**
 * Weighted, not a raw completed-item count: a missing hotel confirmation must
 * not be offset by three finished communication tasks.
 */
const CATEGORY_WEIGHT: Record<ReadinessCategory, number> = {
  FLIGHT: 3,
  VISA: 3,
  HOTEL: 3,
  TRANSPORT: 3,
  DOCUMENT: 3,
  PAYMENT: 2,
  ROOMING: 2,
  GUIDE: 2,
  MANIFEST: 2,
  CATERING: 1,
  OTHER: 1,
};

const STATUS_PROGRESS: Record<ReadinessItemStatus, number> = {
  COMPLETE: 1,
  IN_PROGRESS: 0.5,
  AT_RISK: 0.5,
  BLOCKED: 0,
  NOT_STARTED: 0,
  NOT_REQUIRED: 0,
};

const CATEGORY_LABELS: Record<ReadinessCategory, string> = {
  FLIGHT: "Flights",
  VISA: "Visa",
  HOTEL: "Hotels",
  TRANSPORT: "Transport",
  DOCUMENT: "Pilgrims & Documents",
  PAYMENT: "Payments",
  ROOMING: "Rooming",
  GUIDE: "Guide & Operations",
  MANIFEST: "Manifest",
  CATERING: "Catering",
  OTHER: "Other",
};

const CATEGORY_TAB: Record<
  ReadinessCategory,
  ReadinessCategoryProgress["tab"]
> = {
  FLIGHT: "flights",
  VISA: "documents",
  HOTEL: "hotels",
  TRANSPORT: "transport",
  DOCUMENT: "documents",
  PAYMENT: "payments",
  ROOMING: "hotels",
  GUIDE: "guide",
  MANIFEST: "pilgrims",
  CATERING: "readiness",
  OTHER: "readiness",
};

export function scoreReadiness(
  items: DepartureGroupReadinessItemRow[],
): DepartureGroupReadinessSummary {
  const scored = items.filter((item) => item.status !== "NOT_REQUIRED");

  if (scored.length === 0) {
    return {
      score: 0,
      status: "NOT_STARTED",
      blockerCount: 0,
      dueTodayCount: 0,
      dueInSevenDaysCount: 0,
      categories: [],
    };
  }

  let earned = 0;
  let total = 0;
  const byCategory = new Map<
    ReadinessCategory,
    { earned: number; weight: number; complete: number; count: number }
  >();

  for (const item of scored) {
    const weight = CATEGORY_WEIGHT[item.category];
    const progress = STATUS_PROGRESS[item.status];
    earned += weight * progress;
    total += weight;

    const bucket = byCategory.get(item.category) ?? {
      earned: 0,
      weight: 0,
      complete: 0,
      count: 0,
    };
    bucket.earned += weight * progress;
    bucket.weight += weight;
    bucket.complete += item.status === "COMPLETE" ? 1 : 0;
    bucket.count += 1;
    byCategory.set(item.category, bucket);
  }

  const score = Math.round((earned / total) * 100);
  const blockerCount = scored.filter(
    (item) => item.status === "BLOCKED" || item.status === "AT_RISK",
  ).length;
  const anyStarted = scored.some((item) => item.status !== "NOT_STARTED");

  /**
   * A single stuck supplier is "at risk", not "blocked" — a group at 75% with
   * one unconfirmed hotel is still recoverable, and calling it blocked would
   * make the badge useless for spotting groups that genuinely cannot depart.
   * Blocked means the group is materially stalled: two or more critical items
   * stuck, or the score has fallen below half.
   */
  const criticalBlocked = scored.filter(
    (item) => item.status === "BLOCKED" && CATEGORY_WEIGHT[item.category] === 3,
  ).length;
  const hardBlocked = criticalBlocked >= 2 || (anyStarted && score < 50);

  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const sevenDays = now + 7 * 86_400_000;

  const dueTodayCount = scored.filter(
    (item) =>
      item.status !== "COMPLETE" &&
      item.due_at !== null &&
      Date.parse(item.due_at) >= startOfToday.getTime() &&
      Date.parse(item.due_at) <= endOfToday.getTime(),
  ).length;

  const dueInSevenDaysCount = scored.filter(
    (item) =>
      item.status !== "COMPLETE" &&
      item.due_at !== null &&
      Date.parse(item.due_at) > endOfToday.getTime() &&
      Date.parse(item.due_at) <= sevenDays,
  ).length;

  const categories: ReadinessCategoryProgress[] = [...byCategory.entries()]
    .map(([category, bucket]) => {
      const percent = Math.round((bucket.earned / bucket.weight) * 100);
      return {
        category,
        label: CATEGORY_LABELS[category],
        percent,
        total: bucket.count,
        complete: bucket.complete,
        status: categoryStatus(percent),
        tab: CATEGORY_TAB[category],
      };
    })
    .sort((a, b) => CATEGORY_WEIGHT[b.category] - CATEGORY_WEIGHT[a.category]);

  return {
    score,
    status: hardBlocked
      ? "BLOCKED"
      : !anyStarted
        ? "NOT_STARTED"
        : score >= 90 && blockerCount === 0
          ? "READY"
          : "AT_RISK",
    blockerCount,
    dueTodayCount,
    dueInSevenDaysCount,
    categories,
  };
}

function categoryStatus(
  percent: number,
): DepartureGroupReadinessSummary["status"] {
  if (percent === 0) return "NOT_STARTED";
  if (percent >= 90) return "READY";
  if (percent < 50) return "BLOCKED";
  return "AT_RISK";
}

/* ── Row → view model ─────────────────────────────────────────────────────── */

function toGroup(
  row: DepartureGroupRow,
  readiness: DepartureGroupReadinessSummary,
  snapshot: DepartureGroupPackageSnapshotRow | undefined,
  primaryBlocker: string,
): DepartureGroupListItem {
  const packageName = snapshot?.package_name_snapshot ?? "Unknown template";
  const packageCode = snapshot?.package_code_snapshot ?? "";

  return {
    id: row.id,
    agencyId: row.agency_id,
    branchId: row.branch_id,
    branch: row.branch,
    // The FK is null for a built-in template, but callers still need the key
    // the group was created from — the snapshot keeps it.
    packageTemplateId:
      row.package_template_id ?? snapshot?.source_template_key ?? "",
    groupName: row.group_name,
    groupCode: row.group_code,
    journeyType: row.journey_type,
    groupStatus: row.group_status,
    salesStatus: row.sales_status,
    departureDate: row.departure_date,
    returnDate: row.return_date,
    durationDays: row.duration_days,
    durationNights: row.duration_nights,
    capacity: row.capacity,
    minimumGroupSize: row.minimum_group_size,
    bookedSeats: row.booked_seats,
    heldSeats: row.held_seats,
    availableSeats: row.available_seats,
    waitlistEnabled: row.waitlist_enabled,
    seatHoldExpiryHours: row.seat_hold_expiry_hours,
    primaryGuideId: row.primary_guide_id,
    primaryGuideName: row.primary_guide_name,
    primaryGuideSupplierId: row.primary_guide_supplier_id,
    backupGuideName: row.backup_guide_name,
    operationsOwnerName: row.operations_owner_name,
    visaOwnerName: row.visa_owner_name,
    financeOwnerName: row.finance_owner_name,
    localCoordinatorName: row.local_coordinator_name,
    localCoordinatorPhone: row.local_coordinator_phone,
    emergencyPhone: row.emergency_phone,
    guideWhatsappLink: row.guide_whatsapp_link,
    pilgrimBroadcastLink: row.pilgrim_broadcast_link,
    umrahCompanyName: row.umrah_company_name,
    nusukProgramRef: row.nusuk_program_ref,
    nusukGroupRef: row.nusuk_group_ref,
    visaBatchRef: row.visa_batch_ref,
    visaInvoiceRef: row.visa_invoice_ref,
    nusukStatus: row.nusuk_status,
    readinessScore: readiness.score,
    readinessStatus: readiness.status,
    archived: row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    packageTemplateName: packageName,
    packageTemplateCode: packageCode,
    daysUntilDeparture: daysBetween(
      colomboDayKey(),
      row.departure_date,
    ),
    primaryBlocker,
  };
}

function toPilgrimCharge(row: DepartureGroupPilgrimChargeRow): PilgrimCharge {
  return {
    id: row.id,
    groupPilgrimId: row.group_pilgrim_id,
    chargeType: row.charge_type,
    addonId: row.addon_id,
    label: row.label,
    amount: row.amount,
    quantity: row.quantity,
    currency: row.currency,
    source: row.source,
    pricedRoomType: row.priced_room_type,
    reason: row.reason,
    requiresApproval: row.requires_approval,
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}

function toPilgrimDeviation(row: DepartureGroupPilgrimDeviationRow): PilgrimDeviation {
  return {
    id: row.id,
    groupPilgrimId: row.group_pilgrim_id,
    deviationType: row.deviation_type,
    detail: row.detail,
    summary: row.summary,
    status: row.status,
    responsibleRole: row.responsible_role,
    blocksDeparture: row.blocks_departure,
    chargeId: row.charge_id,
    linkedFlightId: row.linked_flight_id,
    linkedAccommodationId: row.linked_accommodation_id,
    linkedTransportId: row.linked_transport_id,
    linkedItineraryItemIds: row.linked_itinerary_item_ids,
    requestedAt: row.requested_at,
    requestedByName: row.requested_by_name,
    decidedAt: row.decided_at,
    decidedByName: row.decided_by_name,
    decisionNote: row.decision_note,
    arrangedAt: row.arranged_at,
    notes: row.notes,
  };
}

function toReadinessItem(
  row: DepartureGroupReadinessItemRow,
): DepartureGroupReadinessItem {
  return {
    id: row.id,
    departureGroupId: row.departure_group_id,
    sourceTemplateRequirementId: row.source_template_requirement_id,
    label: row.label,
    category: row.category,
    responsibleRole: row.responsible_role,
    assignedToUserId: row.assigned_to_user_id,
    assignedToName: row.assigned_to_name,
    dueType: row.due_type,
    dueDaysBeforeDeparture: row.due_days_before_departure,
    dueAt: row.due_at,
    dueLabel: dueLabelFor(row.due_type, row.due_days_before_departure),
    required: row.required,
    status: row.status,
    autoSource: row.auto_source,
    autoSourceHint: row.auto_source
      ? AUTO_SOURCE_HINTS[row.auto_source]
      : null,
    evidenceUrl: row.evidence_url,
    notes: row.notes,
    completedAt: row.completed_at,
    // The drawer prints this as "by <name>", so it takes the name column, not
    // the `auth.users` id the audit FK holds.
    completedBy: row.completed_by_name,
  };
}

function toFlight(
  row: DepartureGroupFlightRow,
  store: DepartureGroupStore,
): DepartureGroupFlight {
  return {
    id: row.id,
    departureGroupId: row.departure_group_id,
    direction: row.direction,
    status: row.status,
    airline: row.airline,
    flightNumber: row.flight_number,
    pnr: row.pnr,
    bookingReference: row.booking_reference,
    originAirportCode: row.origin_airport_code,
    originAirportName: row.origin_airport_name,
    destinationAirportCode: row.destination_airport_code,
    destinationAirportName: row.destination_airport_name,
    departureAt: row.departure_at,
    arrivalAt: row.arrival_at,
    cabinClass: row.cabin_class,
    seatCapacity: row.seat_capacity,
    seatsHeld: row.seats_held,
    seatsTicketed: row.seats_ticketed,
    ticketingDeadline: row.ticketing_deadline,
    supplierName: row.supplier_name,
    supplierId: row.supplier_id,
    notes: row.notes,
    legs: store.flightLegs
      .filter((leg) => leg.flight_id === row.id)
      .sort((a, b) => a.leg_order - b.leg_order)
      .map((leg) => ({
        id: leg.id,
        flightId: leg.flight_id,
        legOrder: leg.leg_order,
        airline: leg.airline,
        flightNumber: leg.flight_number,
        originAirportCode: leg.origin_airport_code,
        destinationAirportCode: leg.destination_airport_code,
        departureAt: leg.departure_at,
        arrivalAt: leg.arrival_at,
        transitDurationMinutes: leg.transit_duration_minutes,
      })),
  };
}

function toAccommodation(
  row: DepartureGroupAccommodationRow,
  store: DepartureGroupStore,
  canSeeCosts: boolean,
): DepartureGroupAccommodation {
  const rooms = store.rooms.filter((room) => room.accommodation_id === row.id);
  /**
   * Allocated is "rooms with someone in them", derived here for the same reason
   * the readiness score is: no mutator ever wrote `rooms_allocated`, so the
   * stored column sat at its seeded value while the rooming list moved
   * underneath it, and the Hotels tab showed the two disagreeing.
   */
  const roomsAllocated = rooms.filter(
    (room) => room.assigned_pilgrim_count > 0,
  ).length;

  return {
    id: row.id,
    departureGroupId: row.departure_group_id,
    city: row.city,
    hotelName: row.hotel_name,
    supplierName: row.supplier_name,
    supplierId: row.supplier_id,
    bookingReference: row.booking_reference,
    status: row.status,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    nights: row.nights,
    roomCapacity: row.room_capacity,
    roomsReserved: row.rooms_reserved,
    roomsAllocated,
    mealPlan: row.meal_plan,
    distanceDescription: row.distance_description,
    voucherUrl: row.voucher_url,
    internalCost: canSeeCosts ? row.internal_cost : null,
    notes: row.notes,
    rooms: rooms
      .map((room) => ({
        id: room.id,
        accommodationId: room.accommodation_id,
        hotelName: row.hotel_name,
        city: row.city,
        roomNumber: room.room_number,
        roomType: room.room_type,
        occupancyCapacity: room.occupancy_capacity,
        assignedPilgrimCount: room.assigned_pilgrim_count,
        status: room.status,
        notes: room.notes,
      })),
  };
}

/**
 * Overdue is a function of the clock, not a stored opinion, so it is derived
 * here the same way the readiness score is. A stored `OVERDUE` on a task that
 * is not actually past due would contradict the "Due in 2 days" printed beside
 * it; deriving it means the badge and the date can never disagree.
 */
function toTask(row: DepartureGroupTaskRow): DepartureGroupTask {
  const due = Date.parse(row.due_at);
  const days = Math.round((due - Date.now()) / 86_400_000);
  const pastDue = Number.isFinite(due) && due < Date.now();

  const status: TaskStatus =
    row.status === "COMPLETE"
      ? "COMPLETE"
      : pastDue
        ? "OVERDUE"
        : row.status === "OVERDUE"
          ? "OPEN"
          : row.status;

  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;

  return {
    id: row.id,
    departureGroupId: row.departure_group_id,
    title: row.title,
    description: row.description,
    ownerName: row.owner_name,
    dueAt: row.due_at,
    dueLabel:
      days < 0
        ? `${plural(Math.abs(days), "day")} overdue`
        : days === 0
          ? "Due today"
          : `Due in ${plural(days, "day")}`,
    status,
    category: row.category,
    linkedReadinessItemId: row.linked_readiness_item_id,
  };
}

/* ── Money ────────────────────────────────────────────────────────────────── */

function buildPaymentSummary(
  groupId: string,
  store: DepartureGroupStore,
  currency: string,
  canSeeCosts: boolean,
): DepartureGroupPaymentSummary {
  const bookings = store.bookings.filter(
    (b) => b.departure_group_id === groupId && b.booking_status !== "CANCELLED",
  );
  const now = Date.now();

  const expectedRevenue = bookings.reduce(
    (sum, b) => sum + b.total_booking_value,
    0,
  );
  const collectedAmount = bookings.reduce((sum, b) => sum + b.amount_paid, 0);
  const outstandingAmount = bookings.reduce(
    (sum, b) => sum + b.outstanding_balance,
    0,
  );
  // One definition of overdue — a balance still owed past its due date — used
  // for both the money and the count, so the two can never drift apart.
  const overdueBookings = bookings.filter(
    (b) =>
      b.outstanding_balance > 0 &&
      b.next_due_at !== null &&
      Date.parse(b.next_due_at) < now,
  );
  const overdueAmount = overdueBookings.reduce(
    (sum, b) => sum + b.outstanding_balance,
    0,
  );

  const refundPendingBookingIds = new Set(
    store.pilgrims
      .filter(
        (p) =>
          p.departure_group_id === groupId &&
          p.payment_status === "REFUND_PENDING",
      )
      .map((p) => p.booking_id),
  );
  // Cancelled bookings are excluded from the revenue lines above but must count
  // here: a cancellation is exactly when money already collected becomes a
  // refund the agency owes.
  const refundPendingAmount = store.bookings
    .filter(
      (b) =>
        b.departure_group_id === groupId && refundPendingBookingIds.has(b.id),
    )
    .reduce(
      (sum, b) =>
        sum +
        (b.cancellation_refund_amount ??
          // Legacy rows predate the explicit liability column. Keep their
          // historical collected amount visible until they are reconciled.
          b.amount_paid),
      0,
    );

  const supplierPayablesDue = canSeeCosts
    ? store.accommodations
        .filter(
          (a) =>
            a.departure_group_id === groupId &&
            (a.status === "REQUESTED" || a.status === "CONFIRMED"),
        )
        .reduce((sum, a) => sum + (a.internal_cost ?? 0), 0) +
      store.transports
        .filter(
          (t) =>
            t.departure_group_id === groupId &&
            (t.status === "REQUESTED" || t.status === "CONFIRMED"),
        )
        .reduce((sum, t) => sum + (t.internal_cost ?? 0), 0)
    : 0;

  return {
    expectedRevenue,
    collectedAmount,
    outstandingAmount,
    overdueAmount,
    refundPendingAmount,
    supplierPayablesDue,
    currency,
    overdueBookingIds: overdueBookings.map((b) => b.id),
  };
}

/* ── Blockers ─────────────────────────────────────────────────────────────── */

const VISA_PENDING_STATES = new Set([
  "NOT_STARTED",
  "DOCUMENTS_PENDING",
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "REJECTED",
  "REWORK_REQUIRED",
]);

export function buildBlockers(
  group: DepartureGroupRow,
  store: DepartureGroupStore,
  readinessItems: DepartureGroupReadinessItemRow[],
  allPilgrims: DepartureGroupPilgrimRow[],
): DepartureGroupBlocker[] {
  const blockers: DepartureGroupBlocker[] = [];

  /**
   * A withdrawn traveller is not an outstanding task, and neither is someone
   * on the waitlist who has never actually been given a seat.
   *
   * Every count below used to run over every non-cancelled pilgrim row on the
   * group, waitlist included. Because a cancellation left the visa status
   * untouched and reset the room assignment to `UNASSIGNED`, a cancelled
   * booking produced a CRITICAL "N pilgrims have visa applications pending"
   * and a "rooming is 8 / 12 assigned" that nothing could ever clear — the
   * only thing that would clear them was work nobody was going to do for a
   * traveller who is no longer coming. A waitlisted traveller has the mirror
   * problem: they have no seat yet, so demanding their visa or rooming be
   * sorted is asking for work on a trip they may never take.
   */
  const pilgrims = allPilgrims.filter((p) => isTravellingPilgrim(store, p));

  const visasPending = pilgrims.filter((p) =>
    VISA_PENDING_STATES.has(p.visa_status),
  ).length;
  if (visasPending > 0) {
    blockers.push({
      id: "visa-pending",
      severity: "CRITICAL",
      message: `${visasPending} pilgrim${visasPending === 1 ? " has" : "s have"} visa applications pending`,
      actionLabel: "Open Visa Queue",
      tab: "documents",
      filter: "visa-queue",
    });
  }

  // A refusal that cannot be reworked is not a queue item — it is a seat that
  // will not travel, and it needs cancelling or moving before departure.
  const visasRefused = pilgrims.filter(
    (p) => p.visa_status === "REJECTED",
  ).length;
  if (visasRefused > 0) {
    blockers.push({
      id: "visa-refused",
      severity: "CRITICAL",
      message: `${visasRefused} visa${visasRefused === 1 ? " has" : "s have"} been refused — those seats cannot travel`,
      actionLabel: "Open Rejected Applications",
      tab: "documents",
      filter: "rejected",
    });
  }

  // Passports are the one thing that cannot be fixed in the last week, so an
  // expiring one is surfaced as its own blocker rather than buried in a
  // document count.
  const passportIssues = pilgrims.filter(
    (p) => !checkPassportValidity(p, group).ok,
  ).length;
  if (passportIssues > 0) {
    blockers.push({
      id: "passport-validity",
      severity: "CRITICAL",
      message: `${passportIssues} traveller${passportIssues === 1 ? "'s passport" : "s' passports"} fail the six-month validity rule or have no expiry recorded`,
      actionLabel: "Open Traveller Documents",
      tab: "documents",
      filter: "missing-documents",
    });
  }

  for (const accommodation of store.accommodations.filter(
    (a) => a.departure_group_id === group.id,
  )) {
    if (accommodation.status !== "CONFIRMED" && accommodation.status !== "COMPLETED") {
      const city =
        accommodation.city.charAt(0) + accommodation.city.slice(1).toLowerCase();
      blockers.push({
        id: `hotel-${accommodation.id}`,
        severity: "CRITICAL",
        message: `${city} hotel confirmation is missing`,
        actionLabel: "Open Hotel Booking",
        tab: "hotels",
        filter: accommodation.id,
      });
    }
  }

  const overdueBookings = store.bookings.filter(
    (b) =>
      b.departure_group_id === group.id &&
      b.booking_status !== "CANCELLED" &&
      b.next_due_at !== null &&
      Date.parse(b.next_due_at) < Date.now() &&
      b.outstanding_balance > 0,
  ).length;
  // An overdue balance is a scheduling fact, not a finance figure — no amount
  // is named — so it belongs on the list's primary blocker too. Gating it on
  // `payments` meant the list, which never builds a payment summary, silently
  // dropped it while the Overview showed it.
  if (overdueBookings > 0) {
    blockers.push({
      id: "payments-overdue",
      severity: "WARNING",
      message: `${overdueBookings} booking${overdueBookings === 1 ? " has" : "s have"} overdue balances`,
      actionLabel: "Open Payment Queue",
      tab: "payments",
      filter: "overdue",
    });
  }

  const assigned = pilgrims.filter(
    (p) => p.room_assignment_status !== "UNASSIGNED",
  ).length;
  if (pilgrims.length > 0 && assigned < pilgrims.length) {
    blockers.push({
      id: "rooming-incomplete",
      severity: "WARNING",
      message: `Rooming list is ${assigned} / ${pilgrims.length} assigned`,
      actionLabel: "Open Rooming",
      tab: "hotels",
      filter: "rooming",
    });
  }

  if (!group.primary_guide_name) {
    blockers.push({
      id: "guide-unassigned",
      severity: "WARNING",
      message: "No primary guide has been assigned",
      actionLabel: "Open Guide & Operations",
      tab: "guide",
    });
  }

  const blockedItems = readinessItems.filter(
    (item) => item.status === "BLOCKED",
  );
  for (const item of blockedItems) {
    if (/hotel/i.test(item.label)) continue; // already surfaced above
    blockers.push({
      id: `readiness-${item.id}`,
      severity: "CRITICAL",
      message: `${item.label} is blocked`,
      actionLabel: "Open Readiness",
      tab: "readiness",
      filter: item.id,
    });
  }

  const unarrangedBlockingDevs = store.pilgrimDeviations.filter(
    (d) =>
      d.departure_group_id === group.id &&
      d.blocks_departure &&
      !["ARRANGED", "DECLINED", "CANCELLED"].includes(d.status),
  ).length;
  if (unarrangedBlockingDevs > 0) {
    blockers.push({
      id: "unarranged-deviations",
      severity: "WARNING",
      message: `${unarrangedBlockingDevs} traveller customisation${unarrangedBlockingDevs === 1 ? "" : "s"} block${unarrangedBlockingDevs === 1 ? "s" : ""} departure and ${unarrangedBlockingDevs === 1 ? "is" : "are"} not yet arranged`,
      actionLabel: "Open Pilgrims",
      tab: "pilgrims",
    });
  }

  // Critical first, then the warnings; the Overview only shows the top five.
  return blockers
    .sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === "CRITICAL" ? -1 : 1,
    )
    .slice(0, 5);
}

function primaryBlockerLabel(blockers: DepartureGroupBlocker[]): string {
  return blockers.length === 0 ? "All clear" : blockers[0].message;
}

export function buildSupplierLines(
  groupId: string,
  store: DepartureGroupStore,
): SupplierStatusLine[] {
  const lines: SupplierStatusLine[] = [];

  const outbound = store.flights.find(
    (f) => f.departure_group_id === groupId && f.direction === "OUTBOUND",
  );
  if (outbound) {
    lines.push({ label: "Flights", status: outbound.status, tab: "flights" });
  }

  for (const accommodation of store.accommodations.filter(
    (a) => a.departure_group_id === groupId,
  )) {
    const city =
      accommodation.city.charAt(0) + accommodation.city.slice(1).toLowerCase();
    lines.push({
      label: `${city} Hotel`,
      status: accommodation.status,
      tab: "hotels",
    });
  }

  for (const transport of store.transports.filter(
    (t) => t.departure_group_id === groupId,
  )) {
    lines.push({
      label: transport.route_label,
      status: transport.status,
      tab: "transport",
    });
  }

  return lines;
}

/* ── Public reads ─────────────────────────────────────────────────────────── */

function snapshotFor(groupId: string, store: DepartureGroupStore) {
  return store.snapshots.find((s) => s.departure_group_id === groupId);
}

export const listDepartureGroups = cache(
  async (options?: {
    includeArchived?: boolean;
    /** Admin client for callers with no session — see `db()` above. */
    client?: Db;
    /** Read only this agency's groups (for a service-role caller, which RLS does not filter). */
    agencyId?: string;
  }): Promise<DepartureGroupListItem[]> => {
    const data = await loadStore(await db(options?.client), {
      only: LIST_COLLECTIONS,
      includeArchived: options?.includeArchived ?? false,
      agencyId: options?.agencyId,
    });

    return data.groups
      .map((row) => {
        // Derived items are recomputed on read as well as on write, so a hotel
        // confirmed in another session moves this row's badge immediately
        // rather than at the next mutation of this group.
        deriveReadinessStatuses(data, row.id);
        const items = data.readinessItems.filter(
          (item) => item.departure_group_id === row.id,
        );
        const readiness = scoreReadiness(items);
        const pilgrims = data.pilgrims.filter(
          (p) => p.departure_group_id === row.id,
        );
        const blockers = buildBlockers(row, data, items, pilgrims);

        return toGroup(
          row,
          readiness,
          snapshotFor(row.id, data),
          primaryBlockerLabel(blockers),
        );
      })
      .sort((a, b) => a.departureDate.localeCompare(b.departureDate));
  },
);

/**
 * Looks up `public.branches` by name (case-insensitive, scoped to the
 * agency) for the group being created. Returns null on no match rather than
 * throwing — a legacy or not-yet-registered branch name is not a reason to
 * fail group creation, only a reason `branch_id` stays unset for that row,
 * exactly as it always has been until this lookup existed.
 */
async function resolveBranchId(client: Db, agencyId: string | null, branchName: string): Promise<string | null> {
  if (!agencyId) return null;
  const { data } = await client
    .from("branches")
    .select("id")
    .eq("agency_id", agencyId)
    .ilike("name", branchName)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Every branch that currently runs groups, for the branch pickers.
 *
 * Derived from the groups themselves rather than a lookup table, so a branch
 * can never be offered as a dead-end choice that nothing belongs to.
 */
export const listGroupBranches = cache(async (): Promise<string[]> => {
  const supabase = await db();
  const { data, error } = await supabase
    .from("departure_groups")
    .select("branch")
    .neq("branch", "");

  if (error) throw error;

  return [
    ...new Set(
      ((data ?? []) as { branch: string }[])
        .map((row) => row.branch)
        .filter(Boolean),
    ),
  ].sort();
});

/**
 * Groups a booking may be moved into: everything still open for travel, minus
 * the group it is already in. Archived, closed, cancelled and already-departed
 * groups are excluded here rather than being offered and then refused — the
 * Server Action re-checks all of it anyway.
 */
export const listMoveTargetGroups = cache(
  async (excludeGroupId: string): Promise<MoveTargetGroupOption[]> => {
    const data = await loadStore(await db(), {
      only: ["groups", "snapshots"],
    });

    return data.groups
      .filter(
        (row) =>
          row.id !== excludeGroupId &&
          row.group_status !== "CANCELLED" &&
          row.group_status !== "CLOSED" &&
          row.group_status !== "DEPARTED" &&
          row.group_status !== "COMPLETED",
      )
      .map((row) => {
        const snapshot = snapshotFor(row.id, data);
        const pricing = snapshot?.pricing_snapshot;

        return {
          id: row.id,
          groupName: row.group_name,
          groupCode: row.group_code,
          packageName: snapshot?.package_name_snapshot ?? "Unknown template",
          departureDate: row.departure_date,
          returnDate: row.return_date,
          branch: row.branch,
          salesStatus: row.sales_status,
          groupStatus: row.group_status,
          capacity: row.capacity,
          availableSeats: row.available_seats,
          waitlistEnabled: row.waitlist_enabled,
          currency: pricing?.currency ?? "LKR",
          priceByRoomType: {
            QUAD: pricing?.quad_price ?? null,
            TRIPLE: pricing?.triple_price ?? null,
            DOUBLE: pricing?.double_price ?? null,
            SINGLE: pricing?.single_price ?? null,
            OTHER: null,
          },
        };
      })
      .sort((a, b) => a.departureDate.localeCompare(b.departureDate));
  },
);

/**
 * A page of a group's activity trail older than `before`, for the Activity
 * tab's "load more" — `getDepartureGroupDetail()` only ever hydrates the
 * newest 200 rows (`activityLimit: 200`), so a group with a long enough
 * history had no way to see anything older than that at all.
 *
 * Not routed through `loadStore()`/the `DepartureGroupStore`: that store's
 * `activity` collection exists to be *written* to by a mutation in
 * progress, not paged through by a read, and pulling every row of a long
 * trail into memory just to slice off the next 100 would be exactly the
 * "drag every activity row across the wire" cost `LIST_COLLECTIONS` was
 * built to avoid for the list screen.
 */
export async function loadMoreGroupActivity(
  groupId: string,
  before: string,
  role: StaffRole,
  limit = 100,
): Promise<GroupActivityLog[]> {
  const can = await getCurrentDepartureCapabilities();
  const supabase = await db();
  const { data, error } = await supabase
    .from("departure_group_activity_logs")
    .select("*")
    .eq("departure_group_id", groupId)
    .lt("created_at", before)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as DepartureGroupActivityLogRow[]).map((a) => ({
    id: a.id,
    departureGroupId: a.departure_group_id,
    actorName: a.actor_name_snapshot,
    actionType: a.action_type,
    entityType: a.entity_type,
    entityId: a.entity_id,
    beforeValue: can.viewFinance ? a.before_value : null,
    afterValue: can.viewFinance ? a.after_value : null,
    message: a.message,
    isSystem: a.is_system,
    isHighImpact: a.is_high_impact,
    createdAt: a.created_at,
  }));
}

export const getDepartureGroupDetail = cache(
  async (
    groupId: string,
    role: StaffRole,
    /**
     * Admin client for callers with no session — see `db()` above and F1 of
     * docs/modules/departure-operations-agent-implementation-plan.md. Without this,
     * every session-less caller silently got the cookie-session client
     * (empty/wrong-tenant, not an error) rather than the client it actually
     * passed nothing to override. `listDepartureGroups({ client })` and
     * `getGroupCostingRow(groupId, client)` already take this; this was the
     * one read in the module that didn't.
     *
     * Note this function is still wrapped in `cache()` — request-scoped
     * memoisation, correct for a page render, wrong for a worker hydrating
     * many groups in one invocation (F2). The Departure Operations Agent
     * does not call this function for that reason; it has its own
     * uncached `buildOpsSnapshot()`. This parameter exists so the function
     * is no longer silently broken for any *other* session-less caller.
     */
    client?: Db,
  ): Promise<DepartureGroupDetail | null> => {
    // The whole group in one hydration — the Overview alone reads flights,
    // hotels, rooming, bookings, readiness and the trail, so fetching per tab
    // would be more round trips for the same rows.
    const detailClient = await db(client);
    const data = await loadStore(detailClient, {
      groupIds: [groupId],
      includeArchived: true,
      activityLimit: 200,
    });
    const row = data.groups.find((g) => g.id === groupId);
    if (!row) return null;

    // A session-less caller (`client`) has no custom role to resolve — it gets
    // the base role's set, as before.
    const can = client
      ? capabilitiesFor(role)
      : await getCurrentDepartureCapabilities();
    const snapshotRow = snapshotFor(groupId, data);
    // Margin is a Finance-only figure — not fetched at all for a role that
    // could never see it, the same posture as `viewSupplierCosts` elsewhere
    // in this function.
    const costingRow = can.viewFinance
      ? await getGroupCostingRow(groupId, detailClient)
      : null;

    // Everything derived is brought current before anything is read off it:
    // document counters and visa stages first, then the readiness items that
    // depend on them. This is a read, so the results are not written back —
    // the next mutation persists them through `syncDerivedColumns`.
    syncGroupDerivedState(data, groupId);
    deriveReadinessStatuses(data, groupId);

    const readinessRows = data.readinessItems.filter(
      (item) => item.departure_group_id === groupId,
    );
    const readiness = scoreReadiness(readinessRows);
    const pilgrimRows = data.pilgrims.filter(
      (p) => p.departure_group_id === groupId,
    );
    const bookingRows = data.bookings.filter(
      (b) => b.departure_group_id === groupId,
    );

    const currency = snapshotRow?.pricing_snapshot.currency ?? "LKR";
    const payments = can.viewFinance
      ? buildPaymentSummary(groupId, data, currency, can.viewSupplierCosts)
      : null;

    const blockers = buildBlockers(row, data, readinessRows, pilgrimRows);
    const group = toGroup(
      row,
      readiness,
      snapshotRow,
      primaryBlockerLabel(blockers),
    );

    const roomsById = new Map(data.rooms.map((room) => [room.id, room]));
    const bookingsById = new Map(bookingRows.map((b) => [b.id, b]));
    const accommodationsById = new Map(data.accommodations.map((a) => [a.id, a]));
    // A pilgrim holds one room per accommodation (Makkah and Madinah
    // simultaneously) — grouped here so `roomLabel`/`roomAssignmentStatus`
    // stay a simple "do they have a room" rollup while the per-city detail
    // lives in `roomAssignments`. See `departure_group_room_assignments`'s
    // `unique (pilgrim_id, accommodation_id)` constraint.
    const roomAssignmentsByPilgrim = new Map<
      string,
      { accommodationId: string; city: AccommodationCity; roomId: string; roomLabel: string }[]
    >();
    for (const assignmentRow of data.roomAssignments) {
      const room = roomsById.get(assignmentRow.room_id);
      const accommodation = accommodationsById.get(assignmentRow.accommodation_id);
      if (!room || !accommodation) continue;
      const list = roomAssignmentsByPilgrim.get(assignmentRow.pilgrim_id) ?? [];
      list.push({
        accommodationId: accommodation.id,
        city: accommodation.city,
        roomId: room.id,
        roomLabel: `${room.room_number ?? "—"} · ${room.room_type}`,
      });
      roomAssignmentsByPilgrim.set(assignmentRow.pilgrim_id, list);
    }

    const manifest: DepartureGroupManifestRow[] = pilgrimRows.map((p) => {
      const booking = bookingsById.get(p.booking_id);
      const room = p.room_id ? roomsById.get(p.room_id) : undefined;
      const passport = checkPassportValidity(p, row);
      return {
        id: p.id,
        departureGroupId: p.departure_group_id,
        bookingId: p.booking_id,
        pilgrimId: p.pilgrim_id,
        fullName: p.full_name_snapshot,
        phone: p.phone_snapshot,
        // Passport numbers are traveller PII, not operational trivia.
        passportNumber: can.viewSensitiveTravellerData
          ? p.passport_number_snapshot
          : null,
        seatStatus: p.seat_status,
        flightStatus: p.flight_status,
        roomAssignmentStatus: p.room_assignment_status,
        roomId: p.room_id,
        roomLabel: room ? `${room.room_number} · ${room.room_type}` : null,
        roomAssignments: roomAssignmentsByPilgrim.get(p.id) ?? [],
        passportExpiry: can.viewSensitiveTravellerData ? p.passport_expiry : null,
        passportValidityIssue: passport.ok ? null : passport.reason,
        documentsCompleted: p.documents_completed,
        documentsRequired: p.documents_required,
        documentCompletionPercent: p.document_completion_percent,
        // The checklist itself, not just its length — this is what makes
        // "4 / 8" answerable on screen.
        documents: (can.viewSensitiveTravellerData
          ? data.pilgrimDocuments.filter((d) => d.pilgrim_id === p.id)
          : []
        ).map((d) => ({
          id: d.id,
          pilgrimId: d.pilgrim_id,
          requirementId: d.requirement_id,
          name: d.name,
          category: d.category,
          required: d.required,
          requiredByStage: d.required_by_stage,
          verifiedByRole: d.verified_by_role,
          status: d.status,
          filePath: d.file_path,
          fileName: d.file_name,
          rejectionReason: d.rejection_reason,
          submittedAt: d.submitted_at,
          verifiedAt: d.verified_at,
          verifiedByName: d.verified_by_name,
          notes: d.notes,
        })),
        visaStatus: p.visa_status,
        visaSubmittedAt: p.visa_submitted_at,
        visaId: can.viewSensitiveTravellerData ? p.visa_id : null,
        visaIssueNote: p.visa_issue_note,
        visaRejectionReason: p.visa_rejection_reason,
        visaExpiryDate: p.visa_expiry_date,
        visaFilePath: can.viewSensitiveTravellerData ? p.visa_file_path : null,
        visaAiStatus: p.visa_ai_status,
        visaAiExtracted: can.viewSensitiveTravellerData ? p.visa_ai_extracted : null,
        visaAiIssues: p.visa_ai_issues,
        visaAiAnalyzedAt: p.visa_ai_analyzed_at,
        visaAiError: p.visa_ai_error,
        ticketFilePath: can.viewSensitiveTravellerData ? p.ticket_file_path : null,
        ticketFileName: p.ticket_file_name,
        ticketUploadedAt: p.ticket_uploaded_at,
        ticketAiStatus: p.ticket_ai_status,
        ticketAiExtracted: can.viewSensitiveTravellerData ? p.ticket_ai_extracted : null,
        ticketAiIssues: p.ticket_ai_issues,
        ticketAiAnalyzedAt: p.ticket_ai_analyzed_at,
        ticketAiError: p.ticket_ai_error,
        paymentStatus: p.payment_status,
        emergencyContactStatus: p.emergency_contact_status,
        emergencyContactName: can.viewSensitiveTravellerData
          ? p.emergency_contact_name
          : null,
        emergencyContactPhone: can.viewSensitiveTravellerData
          ? p.emergency_contact_phone
          : null,
        bookingReference: booking?.booking_reference ?? "",
        bookingLabel: booking
          ? `${booking.primary_contact_name.split(" ").slice(-1)[0]} Family`
          : "",
        bookingStatus: booking?.booking_status ?? "HELD",
        roomTypePreference: booking?.room_occupancy_preference ?? "QUAD",
        outstandingBalance: can.viewFinance
          ? (booking?.outstanding_balance ?? 0)
          : 0,
        nextDueAt: booking?.next_due_at ?? null,
        roomOccupancyType:
          p.room_occupancy_type ?? booking?.room_occupancy_preference ?? null,
        totalPrice: can.viewPilgrimPricing
          ? sumChargeLines(data.pilgrimCharges.filter((c) => c.group_pilgrim_id === p.id))
          : null,
        charges: can.viewPilgrimPricing
          ? data.pilgrimCharges
              .filter((c) => c.group_pilgrim_id === p.id)
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
              .map(toPilgrimCharge)
          : [],
        deviations: data.pilgrimDeviations
          .filter((d) => d.group_pilgrim_id === p.id)
          .sort((a, b) => a.requested_at.localeCompare(b.requested_at))
          .map(toPilgrimDeviation),
        hasCustomisations: p.has_customisations,
      };
    });

    const bookings: DepartureGroupBooking[] = bookingRows.map((b) => ({
      id: b.id,
      departureGroupId: b.departure_group_id,
      leadId: b.lead_id,
      bookingReference: b.booking_reference,
      bookingStatus: b.booking_status,
      primaryContactName: b.primary_contact_name,
      primaryContactPhone: b.primary_contact_phone,
      travellerCount: b.traveller_count,
      roomOccupancyPreference: b.room_occupancy_preference,
      packagePricePerPerson: can.viewFinance ? b.package_price_per_person : 0,
      totalBookingValue: can.viewFinance ? b.total_booking_value : 0,
      amountPaid: can.viewFinance ? b.amount_paid : 0,
      outstandingBalance: can.viewFinance ? b.outstanding_balance : 0,
      nextDueAt: b.next_due_at,
      seatHoldExpiresAt: b.seat_hold_expires_at,
      bookedAt: b.booked_at,
      createdAt: b.created_at,
      payerPilgrimId: b.payer_pilgrim_id ?? null,
      payerLeadId: b.payer_lead_id ?? null,
      payerName: b.payer_name ?? null,
      payerEmail: b.payer_email ?? null,
      bookingType: b.booking_type ?? "GROUP",
    }));

    const transports: DepartureGroupTransport[] = data.transports
      .filter((t) => t.departure_group_id === groupId)
      .map((t) => ({
        id: t.id,
        departureGroupId: t.departure_group_id,
        templateTransportRequirementId: t.template_transport_requirement_id,
        routeLabel: t.route_label,
        origin: t.origin,
        destination: t.destination,
        status: t.status,
        supplierName: t.supplier_name,
        supplierId: t.supplier_id,
        bookingReference: t.booking_reference,
        vehicleType: t.vehicle_type,
        vehicleCapacity: t.vehicle_capacity,
        passengerCount: t.passenger_count,
        pickupAt: t.pickup_at,
        pickupLocation: t.pickup_location,
        driverName: t.driver_name,
        driverPhone: t.driver_phone,
        coordinatorName: t.coordinator_name,
        coordinatorPhone: t.coordinator_phone,
        internalCost: can.viewSupplierCosts ? t.internal_cost : null,
        confirmationUrl: t.confirmation_url,
        notes: t.notes,
      }));

    const activity: GroupActivityLog[] = data.activity
      .filter((a) => a.departure_group_id === groupId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((a) => ({
        id: a.id,
        departureGroupId: a.departure_group_id,
        actorName: a.actor_name_snapshot,
        actionType: a.action_type,
        entityType: a.entity_type,
        entityId: a.entity_id,
        // Money deltas stay out of the trail for roles without finance access.
        beforeValue: can.viewFinance ? a.before_value : null,
        afterValue: can.viewFinance ? a.after_value : null,
        message: a.message,
        isSystem: a.is_system,
        isHighImpact: a.is_high_impact,
        createdAt: a.created_at,
      }));

    // Fetched fresh, not read off the snapshot, specifically so "compare
    // with template" has something genuinely live to compare the frozen
    // snapshot against — see finding C8 in
    // docs/modules/packages-production-readiness-plan.md. Best-effort: a missing
    // or unreadable package (deleted, or this role's RLS predicate
    // excludes it) leaves both fields null rather than failing the whole
    // group-detail read.
    let livePackageTitle: string | null = null;
    let livePackagePublishedVersionId: string | null = null;
    if (snapshotRow?.package_template_id) {
      const { data: liveRow } = await detailClient
        .from("packages")
        .select("title, published_version_id")
        .eq("id", snapshotRow.package_template_id)
        .maybeSingle();
      livePackageTitle = liveRow?.title ?? null;
      livePackagePublishedVersionId = liveRow?.published_version_id ?? null;
    }

    const snapshot: DepartureGroupPackageSnapshot = {
      packageTemplateId: snapshotRow?.package_template_id ?? "",
      packageName: snapshotRow?.package_name_snapshot ?? "",
      packageCode: snapshotRow?.package_code_snapshot ?? "",
      overview: snapshotRow?.overview_snapshot ?? "",
      currency,
      quadPrice: snapshotRow?.pricing_snapshot.quad_price ?? null,
      triplePrice: snapshotRow?.pricing_snapshot.triple_price ?? null,
      doublePrice: snapshotRow?.pricing_snapshot.double_price ?? null,
      singlePrice: snapshotRow?.pricing_snapshot.single_price ?? null,
      advanceDeposit: snapshotRow?.pricing_snapshot.advance_deposit ?? null,
      inclusions: snapshotRow?.inclusions_snapshot ?? [],
      exclusions: snapshotRow?.exclusions_snapshot ?? [],
      itinerary: (snapshotRow?.itinerary_snapshot ?? []).map((item) => ({
        id: item.id,
        dayNumber: item.day_number,
        title: item.title,
        location: item.location,
        description: item.description,
      })),
      copiedAt: snapshotRow?.copied_at ?? row.created_at,
      packageVersionId: snapshotRow?.package_version_id ?? null,
      livePackageTitle,
      livePackagePublishedVersionId,
    };

    const pricingRow = data.pricing.find(
      (p) => p.departure_group_id === groupId,
    );
    const resolvedPrice = groupPrice(pricingRow, snapshotRow?.pricing_snapshot);
    const pricing: DepartureGroupPricing = {
      currency: resolvedPrice.currency,
      quadPrice: resolvedPrice.quadPrice,
      triplePrice: resolvedPrice.triplePrice,
      doublePrice: resolvedPrice.doublePrice,
      singlePrice: resolvedPrice.singlePrice,
      childPrice: resolvedPrice.childPrice,
      infantPrice: resolvedPrice.infantPrice,
      earlyBirdPrice: resolvedPrice.earlyBirdPrice,
      advanceDeposit: resolvedPrice.advanceDeposit,
      priceSource: resolvedPrice.priceSource,
    };

    const costing: DepartureGroupCosting | null = costingRow
      ? {
          listPrice: costingRow.list_price,
          confirmedPax: costingRow.confirmed_pax,
          estimatedVariableCostPerPax: costingRow.estimated_variable_cost_per_pax,
          fixedCostPerDeparture: costingRow.fixed_cost_per_departure,
          actualSupplierCost: costingRow.actual_supplier_cost,
          breakEvenHeadcount: costingRow.break_even_headcount,
          estimatedGrossMargin: costingRow.estimated_gross_margin,
        }
      : null;

    const overview: DepartureGroupOverview = {
      group,
      readiness,
      payments,
      blockers,
      suppliers: buildSupplierLines(groupId, data),
      recentActivity: activity.filter((a) => a.isHighImpact).slice(0, 6),
    };

    const supabase = await db();
    const { data: addonRows } = await supabase
      .from("agency_service_addons")
      .select("id, code, name, category, default_amount, unit, creates_deviation")
      .eq("active", true)
      .order("name");

    const serviceAddons = (addonRows ?? []).map((a: Record<string, unknown>) => ({
      id: a.id as string,
      code: a.code as string,
      name: a.name as string,
      category: a.category as string,
      defaultAmount: (a.default_amount as number) ?? null,
      unit: a.unit as string,
      createsDeviation: a.creates_deviation as boolean,
    }));

    return {
      group,
      snapshot,
      pricing,
      costing,
      overview,
      flights: data.flights
        .filter((f) => f.departure_group_id === groupId)
        .map((f) => toFlight(f, data)),
      accommodations: data.accommodations
        .filter((a) => a.departure_group_id === groupId)
        .map((a) => toAccommodation(a, data, can.viewSupplierCosts)),
      transports,
      bookings,
      manifest,
      payments,
      readinessItems: readinessRows.map(toReadinessItem),
      tasks: data.tasks
        .filter((t) => t.departure_group_id === groupId)
        .map(toTask),
      activity,
      serviceAddons,
      travellerRelationships: data.travellerRelationships
        .filter((r) => r.departure_group_id === groupId)
        .map((r) => ({
          id: r.id,
          bookingId: r.booking_id,
          fromPilgrimId: r.from_pilgrim_id,
          fromName:
            pilgrimRows.find((p) => p.id === r.from_pilgrim_id)
              ?.full_name_snapshot ?? "—",
          toPilgrimId: r.to_pilgrim_id,
          toName:
            pilgrimRows.find((p) => p.id === r.to_pilgrim_id)
              ?.full_name_snapshot ?? "—",
          relationship: r.relationship,
          isMahram: r.is_mahram,
          note: r.note,
          createdByName: r.created_by_name,
          createdAt: r.created_at,
        })),
    };
  },
);

/* ── Package templates for the create flow ────────────────────────────────── */

const JOURNEY_TYPE_BY_LABEL: Record<string, GroupJourneyType> = {
  Umrah: "UMRAH",
  Hajj: "HAJJ",
  "Early Registration": "EARLY_REGISTRATION",
};

/** The columns the create-group picker needs, including Step 6's group defaults and enough scalars to compute completeness. */
type TemplatePickerRow = Pick<
  PackageRow,
  | "id"
  | "title"
  | "internal_code"
  | "description"
  | "journey_type"
  | "category"
  | "package_category"
  | "status"
  | "duration"
  | "days"
  | "nights"
  | "max_pilgrims"
  | "default_capacity"
  | "min_group_size"
  | "cancellation_policy"
  | "payment_milestones_count"
  | "itinerary_days"
  | "transport_requirements_count"
  | "inclusions_count"
  | "exclusions_count"
  | "included_services_count"
  | "document_requirements_count"
  | "group_readiness_checklist_count"
  | "default_group_capacity"
  | "waitlist_enabled"
  | "seat_hold_expiry"
>;

const TEMPLATE_PICKER_COLUMNS =
  "id, title, internal_code, description, journey_type, category, package_category, status, " +
  "duration, days, nights, max_pilgrims, default_capacity, min_group_size, cancellation_policy, " +
  "payment_milestones_count, itinerary_days, transport_requirements_count, inclusions_count, " +
  "exclusions_count, included_services_count, document_requirements_count, " +
  "group_readiness_checklist_count, default_group_capacity, waitlist_enabled, seat_hold_expiry, " +
  "created_at, updated_at";

/**
 * Prefers real `packages` rows and falls back to the seeded library, so the
 * create flow works whether or not the packages table has been provisioned.
 *
 * Reads the Step 6 "Group creation defaults" columns
 * (`default_group_capacity`, `min_group_size`, `waitlist_enabled`,
 * `seat_hold_expiry`) instead of hardcoding `40` / `15` / `true` / `24` — those
 * hardcoded values silently discarded whatever the wizard's own Group
 * Defaults step had recorded.
 *
 * `journeyType` is mapped from `journey_type` (Umrah / Hajj / Early
 * Registration — the 3-value field), not `category` (Umrah / Hajj only) —
 * mapping from `category` meant an Early Registration package could never
 * be offered as anything but "UMRAH" here, which also fed the wrong prefix
 * into `generateGroupCode()`. See
 * docs/modules/packages-production-readiness-plan.md, finding C3.
 *
 * Only Open for Sale packages are offered by default — `includeDrafts`
 * (an ADMIN-only escape hatch, re-checked by `createDepartureGroup()`
 * itself regardless of what this returns) additionally offers Draft ones,
 * each carrying its own `completeness` so the picker can show how far from
 * publishable a given draft actually is.
 */
export async function listPackageTemplateOptions(
  options: { includeDrafts?: boolean } = {},
): Promise<PackageTemplateOption[]> {
  try {
    const supabase = createClient(await cookies());

    const statuses = options.includeDrafts ? ["Open for Sale", "Draft"] : ["Open for Sale"];
    const { data, error } = await supabase
      .from("packages")
      .select(TEMPLATE_PICKER_COLUMNS)
      .in("status", statuses)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("listPackageTemplateOptions: failed to load packages", error);
      return [];
    }
    if (!data) return [];

    // Only the agency's own real packages are ever offered here — no seeded
    // fixtures. An empty result means there is genuinely nothing to pick
    // yet, and the picker's own empty state points the user at creating a
    // package instead.
    return (data as unknown as TemplatePickerRow[]).map(
      (row): PackageTemplateOption => ({
        id: row.id,
        name: row.title || "Untitled package",
        code: row.internal_code,
        journeyType: JOURNEY_TYPE_BY_LABEL[row.journey_type] ?? "UMRAH",
        category: row.category,
        status: row.status,
        defaultCapacity: row.default_group_capacity ?? row.max_pilgrims ?? 40,
        minGroupSize: row.min_group_size ?? 15,
        durationDays: row.days,
        durationNights: row.nights,
        durationLabel: row.duration,
        waitlistEnabled: row.waitlist_enabled,
        seatHoldExpiryHours: parseSeatHoldHours(row.seat_hold_expiry),
        isOpenForSale: row.status === "Open for Sale",
        completeness: listCompletenessPercent(computeListStepGaps(row)),
      }),
    );
  } catch (err) {
    console.error("listPackageTemplateOptions: failed to load packages", err);
    return [];
  }
}

/* ── Narrow reads for the AI sales read model ─────────────────────────────── */

export async function getPackageSnapshotRow(
  groupId: string,
  client?: Db,
): Promise<DepartureGroupPackageSnapshotRow | null> {
  const supabase = await db(client);
  const { data, error } = await supabase
    .from("departure_group_package_snapshots")
    .select("*")
    .eq("departure_group_id", groupId)
    .maybeSingle();

  if (error) throw error;
  return (data as DepartureGroupPackageSnapshotRow | null) ?? null;
}

/**
 * The group's CURRENT, editable price — see `departure_group_pricing`
 * (migration `20260908090000`). Every caller that needs "what does this
 * departure cost right now" should go through this, never through
 * `getPackageSnapshotRow(...).pricing_snapshot`, which is the frozen
 * template price at creation time and is never updated after that.
 */
export async function getGroupPricingRow(
  groupId: string,
  client?: Db,
): Promise<DepartureGroupPricingRow | null> {
  const supabase = await db(client);
  const { data, error } = await supabase
    .from("departure_group_pricing")
    .select("*")
    .eq("departure_group_id", groupId)
    .maybeSingle();

  if (error) throw error;
  return (data as DepartureGroupPricingRow | null) ?? null;
}

/**
 * Reads the derived `departure_group_costing` view — list price, confirmed
 * pax, estimated cost/pax, actual supplier cost booked so far, break-even
 * headcount and estimated margin. Finance-only in the application layer.
 */
export async function getGroupCostingRow(
  groupId: string,
  client?: Db,
): Promise<DepartureGroupCostingRow | null> {
  const supabase = await db(client);
  const { data, error } = await supabase
    .from("departure_group_costing")
    .select("*")
    .eq("departure_group_id", groupId)
    .maybeSingle();

  if (error) throw error;
  return (data as DepartureGroupCostingRow | null) ?? null;
}

/** Only CONFIRMED bookings — the AI agent must never name an unconfirmed hotel. */
export async function listConfirmedHotels(groupId: string, client?: Db) {
  const supabase = await db(client);
  const { data, error } = await supabase
    .from("departure_group_accommodations")
    .select("city, hotel_name, nights")
    .eq("departure_group_id", groupId)
    .eq("status", "CONFIRMED");

  if (error) throw error;

  return ((data ?? []) as { city: string; hotel_name: string; nights: number }[])
    .map((a) => ({
      city: a.city.charAt(0) + a.city.slice(1).toLowerCase(),
      hotelName: a.hotel_name,
      nights: a.nights,
    }));
}

/** Likewise for flights: nothing below CONFIRMED is quotable. */
export async function listConfirmedFlights(groupId: string, client?: Db) {
  const supabase = await db(client);
  const { data, error } = await supabase
    .from("departure_group_flights")
    .select("direction, airline, departure_at, arrival_at")
    .eq("departure_group_id", groupId)
    .in("status", ["CONFIRMED", "TICKETED"]);

  if (error) throw error;

  return (
    (data ?? []) as {
      direction: DepartureGroupFlightRow["direction"];
      airline: string;
      departure_at: string;
      arrival_at: string;
    }[]
  ).map((f) => ({
    direction: f.direction,
    airline: f.airline,
    departureAt: f.departure_at,
    arrivalAt: f.arrival_at,
  }));
}

/**
 * Group codes are unique across archived groups too, so this asks the database
 * rather than the active list — reusing an archived group's code would collide
 * on `departure_groups_code_unique` at insert time.
 */
export async function isGroupCodeTaken(groupCode: string): Promise<boolean> {
  const supabase = await db();
  const { count, error } = await supabase
    .from("departure_groups")
    .select("id", { count: "exact", head: true })
    .ilike("group_code", groupCode.trim());

  if (error) throw error;
  return (count ?? 0) > 0;
}

const JOURNEY_CODE_PREFIX: Record<GroupJourneyType, string> = {
  UMRAH: "UM",
  HAJJ: "HJ",
  EARLY_REGISTRATION: "ER",
};

/**
 * Suggests a group code for the create form: `{journey prefix}-{month}-{yy}-{seq}`,
 * e.g. `UM-AUG-26-01`, matching the convention used across the seeded groups.
 * The sequence is probed against the store rather than derived from a count,
 * since archived and cancelled groups still hold their codes forever.
 */
export async function generateGroupCode(
  journeyType: GroupJourneyType,
  departureDate: string,
): Promise<string> {
  const prefix = JOURNEY_CODE_PREFIX[journeyType] ?? "GR";
  const parsed = new Date(`${departureDate}T00:00:00Z`);
  const valid = !Number.isNaN(parsed.getTime());
  const monthLabel = valid
    ? parsed
        .toLocaleString("en-US", { month: "short", timeZone: "UTC" })
        .toUpperCase()
    : "TBD";
  const yearLabel = String(
    valid ? parsed.getUTCFullYear() : new Date().getUTCFullYear(),
  ).slice(-2);

  for (let seq = 1; seq <= 99; seq++) {
    const candidate = `${prefix}-${monthLabel}-${yearLabel}-${String(seq).padStart(2, "0")}`;
    if (!(await isGroupCodeTaken(candidate))) return candidate;
  }

  // The two-digit sequence is exhausted (99 groups in one prefix/month) —
  // fall back to a suffix that cannot collide.
  return `${prefix}-${monthLabel}-${yearLabel}-${Date.now().toString(36).toUpperCase()}`;
}

/* ── Writes ───────────────────────────────────────────────────────────────── */

export interface CreateDepartureGroupResult {
  groupId: string;
  packageName: string;
}

export type CreateDepartureGroupOutcome =
  | { ok: true; result: CreateDepartureGroupResult }
  | { ok: false; error: string };

/**
 * Creates the group, freezes the package snapshot, copies the selected
 * defaults into editable rows, seeds the readiness state and writes the
 * creation activity entry — in that order, as one unit.
 *
 * Everything is assembled in memory first and flushed once, so a failure part
 * way through leaves no half-built group: the rows are written parent-first in
 * a single `persistStore` pass and any error aborts it before the children go
 * out.
 */
export async function createDepartureGroup(
  input: CreateDepartureGroupInput,
): Promise<CreateDepartureGroupOutcome> {
  const supabase = await db();
  const actor = await currentActor();

  let template: PackageTemplateDefinition;
  try {
    template = await resolveTemplate(input.packageTemplateId, supabase);
  } catch (error) {
    if (error instanceof TemplateNotFoundError) {
      return {
        ok: false,
        error:
          "That package template could not be found. It may have been deleted — refresh and pick another package.",
      };
    }
    throw error;
  }

  // The package's real, database status gates group creation here — never
  // the client's `allowDraftTemplate` claim. `createDepartureGroupAction` /
  // `importDepartureGroupsAction` run their own role check against that
  // input first (for a fast, field-level error), but neither of them used
  // to check the package's actual status at all: a caller could simply omit
  // `allowDraftTemplate` and still create a selling group from a Draft,
  // Sales Closed or Archived package. This is the actual enforcement point.
  // See docs/modules/packages-production-readiness-plan.md, finding A2.
  //
  // A Draft template can still legitimately be used, but only by an
  // ADMIN, and the resulting group can never itself be put on sale — it
  // exists to let an admin plan ahead of general availability.
  // Sales Closed / Archived have no equivalent use case and are always
  // rejected outright.
  if (template.status === "Archived" || template.status === "Sales Closed") {
    return {
      ok: false,
      error:
        template.status === "Archived"
          ? "This package is archived and can no longer be used to create a departure group."
          : "This package's sales are closed and it can no longer be used to create a departure group.",
    };
  }
  let salesStatus = input.salesStatus;
  if (template.status === "Draft") {
    const { role } = await getCurrentStaffRole();
    if (role !== "ADMIN") {
      return {
        ok: false,
        error:
          "Only an administrator can create a departure group from a package that is not yet Open for Sale.",
      };
    }
    // Forced regardless of what the form sent — a group built from an
    // unpublished template is a planning placeholder, never something to
    // actually sell seats on.
    salesStatus = "SALES_CLOSED";
  }

  const data = emptyStore();
  const groupId = newId();
  const now = new Date().toISOString();
  const durationDays = daysBetween(input.departureDate, input.returnDate) + 1;

  // `branch` (the text the form actually offers, from `listGroupBranches()`'s
  // deliberately group-derived list — see that function's own comment) stays
  // authoritative for display; `branch_id` is resolved here so the FK that
  // already exists on this column doesn't sit unpopulated forever. A branch
  // renamed or not yet in `public.branches` just leaves this null, same as
  // today — never a reason to block creating the group.
  const branchId = await resolveBranchId(supabase, actor.agencyId, input.branch);

  const group: DepartureGroupRow = {
    id: groupId,
    agency_id: actor.agencyId,
    branch_id: branchId,
    branch: input.branch,
    // Only a real `packages` row can satisfy the foreign key; a built-in
    // template is recorded on the snapshot instead.
    package_template_id: isUuid(template.id) ? template.id : null,
    group_name: input.groupName,
    group_code: input.groupCode.toUpperCase(),
    journey_type: template.journeyType,
    group_status: "PLANNING",
    sales_status: salesStatus,
    departure_date: input.departureDate,
    return_date: input.returnDate,
    // Duration comes from the group's real dates, never the template's.
    duration_days: durationDays,
    duration_nights: Math.max(durationDays - 1, 0),
    capacity: input.capacity,
    minimum_group_size: input.minimumGroupSize,
    booked_seats: 0,
    held_seats: 0,
    available_seats: input.capacity,
    waitlist_enabled: input.waitlistEnabled,
    seat_hold_expiry_hours: input.seatHoldExpiryHours,
    primary_guide_id: null,
    primary_guide_name: input.primaryGuideName || null,
    primary_guide_supplier_id: null,
    backup_guide_name: null,
    operations_owner_id: null,
    operations_owner_name: input.operationsOwnerName || null,
    visa_owner_id: null,
    visa_owner_name: null,
    finance_owner_id: null,
    finance_owner_name: null,
    local_coordinator_name: null,
    local_coordinator_phone: null,
    emergency_phone: null,
    guide_whatsapp_link: null,
    pilgrim_broadcast_link: null,
    umrah_company_name: null,
    nusuk_program_ref: null,
    nusuk_group_ref: null,
    visa_batch_ref: null,
    visa_invoice_ref: null,
    nusuk_status: "NOT_LINKED",
    readiness_score: 0,
    readiness_status: "NOT_STARTED",
    ready_at: null,
    departed_at: null,
    completed_at: null,
    closed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    archived: false,
    created_at: now,
    updated_at: now,
    created_by: actor.id,
    updated_by: actor.id,
  };

  data.groups.push(group);
  data.snapshots.push(
    buildPackageSnapshot(
      template,
      groupId,
      input.copyOptions,
      now,
      input.pricing.currency,
    ),
  );
  // Always seeded, unlike every other copy — a group with no price of its
  // own is not a valid state. See `buildGroupPricing()`.
  data.pricing.push(
    buildGroupPricing(groupId, input.pricing, template.paymentSchedule, now),
  );
  data.costEstimates.push(
    buildGroupCostEstimate(groupId, input.costEstimate, now),
  );

  if (input.copyOptions.readinessChecklist) {
    data.readinessItems.push(
      ...buildReadinessItems(template, groupId, input.departureDate, () =>
        newId(),
      ),
    );
  }

  if (input.copyOptions.accommodation) {
    data.accommodations.push(
      ...buildAccommodations(
        template,
        groupId,
        input.departureDate,
        () => newId(),
        input.flightRouting.arrivalGateway,
      ),
    );
  }

  if (input.copyOptions.transport) {
    data.transports.push(...buildTransports(template, groupId, () => newId()));
  }

  if (input.copyOptions.flights) {
    data.flights.push(
      ...buildFlights(
        groupId,
        input.departureDate,
        input.returnDate,
        input.flightRouting,
        () => newId(),
      ),
    );
  }

  data.activity.push({
    id: newId(),
    departure_group_id: groupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "GROUP_CREATED",
    entity_type: "GROUP",
    entity_id: groupId,
    before_value: null,
    after_value: {
      package_template: template.name,
      copied: Object.entries(input.copyOptions)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key),
    },
    message: `Departure Group created from ${template.name}. Package configuration copied as an independent snapshot.`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  // The seeded checklist decides the group's opening readiness, so it is
  // stamped on the row rather than left at the default zero.
  syncDerivedColumns(data);

  try {
    await persistStore(supabase, emptyStore(), data, actor.agencyId);
  } catch (error) {
    // The Server Action already pre-checks `isGroupCodeTaken()` before
    // calling this, but that check and this write are not one atomic step
    // — two people submitting the same suggested code at the same instant
    // can both pass it. The database's own `departure_groups_code_agency_unique`
    // constraint is the backstop; this turns its violation into the same
    // friendly, retryable outcome every other backstop constraint produces
    // via `mutate()`, instead of an unhandled exception (this function does
    // not go through `mutate()`, so it needs its own translation here).
    const conflict = concurrencyConflictMessage(error);
    if (conflict) return { ok: false, error: conflict };

    if (error instanceof DeparturePartialWriteError) {
      // Group creation is the one caller of `persistStore()` where a
      // partial write can be COMPLETELY undone rather than merely flagged
      // for a human: unlike the general `mutate()` path above (which can
      // update or delete pre-existing rows, for which "undo" isn't simply
      // "delete it"), everything here is a fresh INSERT from `emptyStore()`
      // — nothing pre-existing is ever touched. Every child table's
      // `departure_group_id` foreign key is `on delete cascade`
      // (departure_group_package_snapshots, _pricing, _cost_estimates,
      // _readiness_items, _accommodations, _transports, _flights,
      // _activity_logs), so deleting the `departure_groups` row itself
      // removes every row `persistStore()` did manage to write before it
      // failed, in one statement — turning "half-built group left behind"
      // into "nothing left behind, try again" without needing the single
      // Postgres transaction `DeparturePartialWriteError`'s own class
      // comment describes as the real, larger fix (still true, and still
      // deferred — see docs/modules/packages-production-readiness-plan.md, finding
      // C1 and its Phase 2 write-up on why a blind RPC rewrite of the
      // shared, heavily-used `persistStore()`/`mutate()` machinery was not
      // attempted without a live database to verify it against).
      const { error: cleanupError } = await supabase
        .from("departure_groups")
        .delete()
        .eq("id", groupId);

      if (cleanupError) {
        // The cleanup itself failed — this genuinely is the emergency
        // `DeparturePartialWriteError`'s own comment describes, so it still
        // needs a human, loudly, rather than a friendly retryable message.
        console.error(
          `[departure-groups] PARTIAL WRITE for group ${groupId} could not be cleaned up: ` +
            `${cleanupError.message}. Original failure: ${error.message}`,
        );
        throw error;
      }

      return {
        ok: false,
        error: "Could not create the departure group — please try again.",
      };
    }

    throw error;
  }

  return { ok: true, result: { groupId, packageName: template.name } };
}

/**
 * Flips a group's archived flag, stamps `updated_at` and records the change on
 * the activity trail. Returns the group name so the action can echo it back, or
 * null when the id doesn't resolve.
 */
export async function setGroupArchived(
  groupId: string,
  archived: boolean,
): Promise<{ groupName: string } | null> {
  const outcome = await mutate([groupId], (data, actor) => {
    const group = data.groups.find((g) => g.id === groupId);
    if (!group) return { ok: false as const, groupName: null };

    if (group.archived === archived) {
      // Nothing to write, and nothing worth a trail entry.
      return { ok: false as const, groupName: group.group_name };
    }

    const now = new Date().toISOString();
    const before = group.archived;
    group.archived = archived;
    group.updated_at = now;
    group.updated_by = actor.id;

    data.activity.push({
      id: newId(),
      departure_group_id: groupId,
      actor_id: actor.id,
      actor_name_snapshot: actor.name,
      action_type: archived ? "GROUP_ARCHIVED" : "GROUP_RESTORED",
      entity_type: "GROUP",
      entity_id: groupId,
      before_value: { archived: before },
      after_value: { archived },
      message: archived
        ? "Group archived and removed from the active list."
        : "Group restored to the active list.",
      is_system: false,
      is_high_impact: true,
      created_at: now,
    });

    return { ok: true as const, groupName: group.group_name };
  });

  return outcome.groupName === null ? null : { groupName: outcome.groupName };
}

/* ── Bookings ─────────────────────────────────────────────────────────────── */

/**
 * Creates a booking against the group. All the logic lives in the pure,
 * testable `createGroupBookingInStore`; this supplies the loaded store,
 * persists what it changed, and adds the one check the store cannot make.
 *
 * `booking_reference` is unique across the whole table, but only this group's
 * bookings are loaded — so a caller-supplied reference is checked against the
 * database first. Without it the collision would surface as a raw constraint
 * violation instead of a message the operator can act on.
 */
export async function createGroupBooking(
  input: CreateGroupBookingInput,
  options?: {
    client?: Db;
    actor?: GroupActor;
    /**
     * Required whenever `client` is the service-role admin client — that
     * client bypasses RLS, so without this the uniqueness check below would
     * scan every agency's booking references instead of just this one's.
     * The session client scopes itself via RLS regardless, so this is a
     * no-op (redundant-but-correct) filter for ordinary UI call sites.
     */
    agencyId?: string;
  },
): Promise<CreateBookingOutcome> {
  const supabase = await db(options?.client);

  if (input.bookingReference?.trim()) {
    let query = supabase
      .from("departure_group_bookings")
      .select("id", { count: "exact", head: true })
      .ilike("booking_reference", input.bookingReference.trim());
    if (options?.agencyId) query = query.eq("agency_id", options.agencyId);
    const { count, error } = await query;

    if (error) throw error;
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error: `Booking reference ${input.bookingReference.trim().toUpperCase()} is already in use.`,
      };
    }
  }

  // A closed group, closed sales, or an ask bigger than what's available is
  // refused here — before any Pilgrims person record is created for it. The
  // authoritative check still runs inside `mutate()` below (this read is
  // outside that transaction's load-modify-write window and so cannot fully
  // close a race against a concurrent booking), but it stops the common case
  // — an obviously oversold or closed group — from polluting the Pilgrims
  // module with profiles for a booking that was never going to succeed.
  let groupQuery = supabase
    .from("departure_groups")
    .select("group_name, group_status, sales_status, available_seats, waitlist_enabled")
    .eq("id", input.departureGroupId);
  if (options?.agencyId) groupQuery = groupQuery.eq("agency_id", options.agencyId);
  const { data: groupRow, error: groupError } = await groupQuery.maybeSingle();
  if (groupError) throw groupError;
  if (!groupRow) {
    return { ok: false, error: "That departure group no longer exists." };
  }
  const precheck = validateBookingRequest(groupRow, input);
  if (!precheck.ok) return precheck;

  // Every traveller a booking creates needs a Pilgrims person record behind
  // it — resolved by passport/WhatsApp so a repeat traveller reuses their
  // existing profile rather than getting a duplicate. See
  // `lib/data/pilgrims-repository.ts:resolveOrCreatePilgrimPerson`.
  const { resolveOrCreatePilgrimPerson } = await import("@/lib/data/pilgrims-repository");
  // Resolved sequentially, not via Promise.all: resolveOrCreatePilgrimPerson
  // generates a new pilgrim's reference from the current row count, so
  // running it concurrently for several new travellers in the same booking
  // has them read the same count and mint the same "PL-YYYY-NNNN" reference,
  // tripping the pilgrims_reference_key unique constraint on the second
  // insert. Awaiting one at a time lets each insert land before the next
  // count read.
  const travellers = Array.from({ length: input.travellerCount }, (_, i) => input.travellers?.[i]);
  const resolvedTravellers: Array<(typeof travellers)[number] & { fullName: string; pilgrimPersonId: string }> = [];
  for (let i = 0; i < travellers.length; i++) {
    const traveller = travellers[i];
    const fullName = traveller?.fullName?.trim() || (i === 0 ? input.primaryContactName : `Traveller ${i + 1}`);
    const whatsapp = traveller?.phone?.trim() || (i === 0 ? input.primaryContactPhone : "");
    const pilgrimPersonId = await resolveOrCreatePilgrimPerson(supabase, {
      fullName,
      whatsappNumber: whatsapp,
      passportNumber: traveller?.passportNumber ?? null,
      passportExpiry: traveller?.passportExpiry ?? null,
      emergencyContactName: traveller?.emergencyContactName ?? null,
      emergencyContactPhone: traveller?.emergencyContactPhone ?? null,
      // On the service-role client this is what keeps a phone or passport match inside the booking's own agency.
      agencyId: options?.agencyId ?? null,
    });
    resolvedTravellers.push({ ...traveller, fullName, pilgrimPersonId });
  }

  const outcome = await mutate(
    [input.departureGroupId],
    (data, actor) => createGroupBookingInStore(data, { ...input, travellers: resolvedTravellers }, actor),
    { ...options, atomic: true },
  );

  if (outcome.ok) {
    await seedPilgrimPaymentMilestones(supabase, outcome.result.bookingId, input.departureGroupId);
    // Finance's booking-grain schedule is a separate projection from the
    // per-traveller Pilgrims schedule. Ensure it exists before the booking is
    // visible to payment plans, receivables and reminders.
    const { ensureBookingPaymentMilestones, recordOpeningBalance } = await import("@/lib/data/finance-repository");
    await ensureBookingPaymentMilestones(supabase, outcome.result.bookingId);
    await recordOpeningBalance(supabase, outcome.result.bookingId, {
      id: options?.actor?.id ?? null,
      name: options?.actor?.name ?? "System",
    });
  }

  return outcome;
}

/**
 * Expands the group's frozen payment schedule into one set of milestone rows
 * per traveller on a freshly created booking — the Pilgrims Payments tab's
 * line items (`pilgrim_payment_milestones`). A booking split across several
 * travellers divides the schedule's amounts evenly per person; a schedule
 * with no fixed amounts (a straight "remaining balance") falls back to one
 * "Full Balance" milestone. Best-effort: failures here must never fail the
 * booking that already exists — but a swallowed failure still has to be
 * loud, because the only visible symptom is a Pilgrims Payments tab that
 * quietly shows no schedule for a traveller who otherwise looks fully
 * booked; nothing else about the booking signals that this step didn't run.
 */
async function seedPilgrimPaymentMilestones(
  supabase: Db,
  bookingId: string,
  departureGroupId: string,
): Promise<void> {
  try {
    const { buildPaymentMilestonesForBooking, allocatePaymentToMilestonesInStore } = await import(
      "@/lib/data/pilgrims"
    );
    const { insertPaymentMilestones } = await import("@/lib/data/pilgrims-repository");

    const [{ data: snapshot }, { data: booking }, { data: enrolments }] = await Promise.all([
      supabase
        .from("departure_group_package_snapshots")
        .select("payment_schedule_snapshot")
        .eq("departure_group_id", departureGroupId)
        .maybeSingle(),
      supabase
        .from("departure_group_bookings")
        .select("id, traveller_count, package_price_per_person, amount_paid")
        .eq("id", bookingId)
        .single(),
      supabase.from("departure_group_pilgrims").select("pilgrim_id").eq("booking_id", bookingId),
    ]);

    if (!booking) return;
    const pilgrimIds = (enrolments ?? []).map((row: { pilgrim_id: string }) => row.pilgrim_id).filter(Boolean);
    if (pilgrimIds.length === 0) return;

    // This projection runs after the booking transaction. Make retries safe:
    // an already seeded booking must retain its paid amounts, notes, and
    // proof metadata rather than receiving duplicate rows or being overwritten.
    const { data: existingMilestones, error: existingError } = await supabase
      .from("pilgrim_payment_milestones")
      .select("id")
      .eq("booking_id", bookingId);
    if (existingError) throw existingError;
    const scheduleCount = Math.max(1, (snapshot?.payment_schedule_snapshot ?? []).length);
    if ((existingMilestones ?? []).length >= pilgrimIds.length * scheduleCount) return;

    const schedule = (
      (snapshot?.payment_schedule_snapshot ?? []) as {
        id: string;
        label: string;
        amount: number | null;
        amount_type: string;
        due_date: string | null;
      }[]
    ).map((item) => ({
      id: item.id,
      label: item.label,
      amount: item.amount,
      amountType: item.amount_type,
      dueDate: item.due_date,
    }));

    const now = new Date().toISOString();
    const rows = buildPaymentMilestonesForBooking(
      bookingId,
      pilgrimIds,
      schedule,
      booking.package_price_per_person,
      now,
    );
    await insertPaymentMilestones(supabase, rows);

    // A deposit taken at booking time already exists on the booking; reflect
    // it onto the new milestones so the Payments tab isn't wrong on day one.
    if (booking.amount_paid > 0) {
      const store: import("@/lib/data/pilgrims-repository").PilgrimStore = {
        pilgrims: [],
        medical: [],
        support: [],
        caseEvents: [],
        caseAttachments: [],
        activity: [],
        paymentMilestones: rows,
      };
      allocatePaymentToMilestonesInStore(
        store,
        { bookingId, amount: booking.amount_paid, recordedByName: "System" },
        now,
      );
      for (const row of rows) {
        if (row.paid_amount > 0) {
          await supabase
            .from("pilgrim_payment_milestones")
            .update({ paid_amount: row.paid_amount, paid_at: row.paid_at })
            .eq("id", row.id);
        }
      }
    }
  } catch (error) {
    // Milestones are a convenience projection of the booking's own money
    // fields — never let a failure here roll back a booking that succeeded.
    // It still has to be reported, not just swallowed: this is the only
    // record that a traveller was left without a payment schedule.
    console.error(
      `[departure-groups] seedPilgrimPaymentMilestones failed for booking ${bookingId} (group ${departureGroupId}):`,
      error,
    );
  }
}

/**
 * Rebuilds the per-traveller payment projection for an existing booking when
 * a prior post-commit seed failed. The operation is idempotent and preserves
 * any rows already present, so it is safe for an admin repair action or a
 * scheduled reconciliation job.
 */
export async function repairPilgrimPaymentMilestonesForBooking(
  supabase: Db,
  bookingId: string,
  departureGroupId: string,
): Promise<void> {
  await seedPilgrimPaymentMilestones(supabase, bookingId, departureGroupId);
}

/**
 * Applies (or, for a reversal, undoes) a payment against a booking's
 * per-traveller `pilgrim_payment_milestones` — the schedule the Pilgrims
 * module's own Payments tab reads. `recordBookingPaymentInStore` /
 * `reverseBookingPaymentInStore` only own the booking's own totals and
 * `booking_payment_milestones` (Finance's schedule); without this, the two
 * schedules only ever agree on the day a booking is created, because nothing
 * updates the Pilgrims-tab one again after that first seed.
 *
 * Same best-effort posture as `seedPilgrimPaymentMilestones`: this is a
 * projection of money that already moved, so a failure here must not roll
 * back a booking mutation that already succeeded — it is reported instead.
 */
async function reconcilePilgrimPaymentMilestones(
  supabase: Db,
  bookingId: string,
  signedAmount: number,
  recordedByName: string,
): Promise<void> {
  if (signedAmount === 0) return;
  try {
    const { allocatePaymentToMilestonesInStore, deallocatePaymentFromMilestonesInStore } = await import(
      "@/lib/data/pilgrims"
    );
    const { data: rows, error } = await supabase
      .from("pilgrim_payment_milestones")
      .select("*")
      .eq("booking_id", bookingId);
    if (error) throw error;
    if (!rows || rows.length === 0) return;

    const store: import("@/lib/data/pilgrims-repository").PilgrimStore = {
      pilgrims: [],
      medical: [],
      support: [],
      caseEvents: [],
      caseAttachments: [],
      activity: [],
      paymentMilestones: rows as import("@/lib/types/pilgrims").PilgrimPaymentMilestoneRow[],
    };
    const now = new Date().toISOString();
    const input = { bookingId, amount: Math.abs(signedAmount), recordedByName };

    if (signedAmount > 0) {
      allocatePaymentToMilestonesInStore(store, input, now);
    } else {
      deallocatePaymentFromMilestonesInStore(store, input, now);
    }

    for (const row of store.paymentMilestones) {
      await supabase
        .from("pilgrim_payment_milestones")
        .update({ paid_amount: row.paid_amount, paid_at: row.paid_at, note: row.note, recorded_by_name: row.recorded_by_name })
        .eq("id", row.id);
    }
  } catch (error) {
    console.error(
      `[departure-groups] reconcilePilgrimPaymentMilestones failed for booking ${bookingId}:`,
      error,
    );
  }
}

/** Records a payment against a booking. */
export async function recordBookingPayment(
  input: RecordPaymentInput,
): Promise<RecordPaymentOutcome> {
  const supabase = await db();
  const outcome = await mutate([input.departureGroupId], (data, actor) =>
    recordBookingPaymentInStore(data, input, actor),
  );
  if (outcome.ok) {
    const { name } = await currentActor();
    await reconcilePilgrimPaymentMilestones(supabase, input.bookingId, input.amount, name);
  }
  return outcome;
}

/**
 * Reverses part or all of a booking's recorded payments. Called from
 * `lib/data/finance-repository.ts` when a Finance payment record is
 * reversed — the payment ledger row is never deleted, this only brings the
 * booking's own totals back in step with it (plan §3.4).
 */
export async function reverseBookingPayment(
  input: ReverseBookingPaymentInput,
): Promise<ReverseBookingPaymentOutcome> {
  const supabase = await db();
  const outcome = await mutate([input.departureGroupId], (data, actor) =>
    reverseBookingPaymentInStore(data, input, actor),
  );
  if (outcome.ok) {
    const { name } = await currentActor();
    await reconcilePilgrimPaymentMilestones(supabase, input.bookingId, -input.amount, name);
  }
  return outcome;
}

/** Moves a booking to a different room occupancy tier. */
export function changeBookingRoomPreference(
  input: ChangeRoomPreferenceInput,
): Promise<ChangeRoomPreferenceOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    changeBookingRoomPreferenceInStore(data, input, actor),
  );
}

/* ── Per-pilgrim customisation ────────────────────────────────────────────── */

export type PilgrimChargeOutcome =
  | { ok: true; charge: PilgrimCharge }
  | { ok: false; error: string };

export type PilgrimDeviationResultOutcome =
  | { ok: true; deviation: PilgrimDeviation }
  | { ok: false; error: string };

function toChargeOutcome(outcome: ChargeMutationOutcome): PilgrimChargeOutcome {
  return outcome.ok
    ? { ok: true, charge: toPilgrimCharge(outcome.charge) }
    : outcome;
}

function toDeviationOutcome(
  outcome: DeviationMutationOutcome,
): PilgrimDeviationResultOutcome {
  return outcome.ok
    ? { ok: true, deviation: toPilgrimDeviation(outcome.deviation) }
    : outcome;
}

/** Replaces a traveller's base fare. See `setBaseFareInStore`. */
export async function setPilgrimBaseFare(
  input: SetBaseFareInput,
): Promise<PilgrimChargeOutcome> {
  const outcome = await mutate([input.departureGroupId], (data, actor) =>
    setBaseFareInStore(data, input, actor),
  );
  return toChargeOutcome(outcome);
}

export interface SetPilgrimRoomTypeInput {
  departureGroupId: string;
  groupPilgrimId: string;
  roomOccupancyType: RoomType;
}

export type SetPilgrimRoomTypeOutcome =
  | { ok: true }
  | { ok: false; error: string };

/** Sets a traveller's occupancy without touching price. */
export function setPilgrimRoomType(
  input: SetPilgrimRoomTypeInput,
): Promise<SetPilgrimRoomTypeOutcome> {
  return mutate([input.departureGroupId], (data, actor) => {
    const pilgrim = data.pilgrims.find((p) => p.id === input.groupPilgrimId);
    if (!pilgrim || pilgrim.departure_group_id !== input.departureGroupId) {
      return { ok: false, error: "That traveller no longer exists." };
    }
    const before = pilgrim.room_occupancy_type;
    pilgrim.room_occupancy_type = input.roomOccupancyType;
    data.activity.push({
      id: newId(),
      departure_group_id: pilgrim.departure_group_id,
      actor_id: actor.id,
      actor_name_snapshot: actor.name,
      action_type: "PILGRIM_ROOM_TYPE_CHANGED",
      entity_type: "PILGRIM",
      entity_id: pilgrim.id,
      before_value: { room_occupancy_type: before },
      after_value: { room_occupancy_type: input.roomOccupancyType },
      message: `${pilgrim.full_name_snapshot}'s room occupancy set to ${input.roomOccupancyType}.`,
      is_system: false,
      is_high_impact: false,
      created_at: new Date().toISOString(),
    });
    return { ok: true };
  });
}

/** Adds a priced line (discount, surcharge, add-on…) to a traveller. */
export async function addPilgrimCharge(
  input: AddChargeInput,
): Promise<PilgrimChargeOutcome> {
  const outcome = await mutate([input.departureGroupId], (data, actor) =>
    addChargeInStore(data, input, actor),
  );
  return toChargeOutcome(outcome);
}

/** Voids a charge line. Never deletes it. */
export async function voidPilgrimCharge(
  input: VoidChargeInput,
): Promise<PilgrimChargeOutcome> {
  const outcome = await mutate([input.departureGroupId], (data, actor) =>
    voidChargeInStore(data, input, actor),
  );
  return toChargeOutcome(outcome);
}

/** Signs off a charge that required approval. */
export async function approvePilgrimCharge(
  input: ApproveChargeInput,
): Promise<PilgrimChargeOutcome> {
  const outcome = await mutate([input.departureGroupId], (data, actor) =>
    approveChargeInStore(data, input, actor),
  );
  return toChargeOutcome(outcome);
}

/** Raises an operational deviation on a traveller. */
export async function requestPilgrimDeviation(
  input: RequestDeviationInput,
): Promise<PilgrimDeviationResultOutcome> {
  const outcome = await mutate([input.departureGroupId], (data, actor) =>
    requestDeviationInStore(data, input, actor),
  );
  return toDeviationOutcome(outcome);
}

/**
 * Creates a deviation + an optional paired charge in one store mutation.
 * The charge is created first; its id is passed to the deviation so the
 * existing decline→void cascade applies for free.
 */
export async function requestPilgrimCustomisation(input: {
  departureGroupId: string;
  groupPilgrimId: string;
  deviationType: RequestDeviationInput["deviationType"];
  summary: string;
  detail: RequestDeviationInput["detail"];
  blocksDeparture?: boolean;
  responsibleRole?: RequestDeviationInput["responsibleRole"];
  notes?: string;
  charge?: {
    chargeType: AddChargeInput["chargeType"];
    addonId?: string;
    label: string;
    amount: number;
    quantity?: number;
    requiresApproval?: boolean;
    reason?: string;
  };
}): Promise<PilgrimDeviationResultOutcome> {
  const outcome = await mutate([input.departureGroupId], (data, actor) => {
    let chargeId: string | undefined;

    if (input.charge) {
      const chargeResult = addChargeInStore(
        data,
        {
          departureGroupId: input.departureGroupId,
          groupPilgrimId: input.groupPilgrimId,
          chargeType: input.charge.chargeType,
          addonId: input.charge.addonId,
          label: input.charge.label,
          amount: input.charge.amount,
          quantity: input.charge.quantity,
          /**
           * A charge paired with a deviation is a quote, not a debt, until
           * someone approves the deviation — `sumBillableChargeLines` already
           * excludes anything `requires_approval` with no `approved_at`, and
           * `decideDeviationInStore` is what stamps `approved_at` once staff
           * say yes. Forced true here regardless of what the caller sent:
           * every deviation created by this flow starts life `REQUESTED`,
           * there is no auto-approved deviation type.
           */
          requiresApproval: true,
          reason:
            input.charge.reason?.trim() ||
            `Pending approval of "${input.summary.trim()}"`,
        },
        actor,
      );
      if (!chargeResult.ok) return chargeResult as unknown as DeviationMutationOutcome;
      chargeId = chargeResult.charge.id;
    }

    return requestDeviationInStore(
      data,
      {
        departureGroupId: input.departureGroupId,
        groupPilgrimId: input.groupPilgrimId,
        deviationType: input.deviationType,
        detail: input.detail,
        summary: input.summary,
        chargeId,
        blocksDeparture: input.blocksDeparture,
        responsibleRole: input.responsibleRole,
        notes: input.notes,
      },
      actor,
    );
  });
  return toDeviationOutcome(outcome);
}

/** Approves or declines a requested deviation. */
export async function decidePilgrimDeviation(
  input: DecideDeviationInput,
): Promise<PilgrimDeviationResultOutcome> {
  const outcome = await mutate([input.departureGroupId], (data, actor) =>
    decideDeviationInStore(data, input, actor),
  );
  return toDeviationOutcome(outcome);
}

/** Marks an approved deviation as arranged. */
export async function markPilgrimDeviationArranged(
  input: MarkDeviationArrangedInput,
): Promise<PilgrimDeviationResultOutcome> {
  const outcome = await mutate([input.departureGroupId], (data, actor) =>
    markDeviationArrangedInStore(data, input, actor),
  );
  return toDeviationOutcome(outcome);
}

/** Cancels a deviation that has not yet been arranged. */
export async function cancelPilgrimDeviation(
  input: CancelDeviationInput,
): Promise<PilgrimDeviationResultOutcome> {
  const outcome = await mutate([input.departureGroupId], (data, actor) =>
    cancelDeviationInStore(data, input, actor),
  );
  return toDeviationOutcome(outcome);
}

/** Records a payment or document reminder against a booking. */
export function sendBookingReminder(
  input: SendBookingReminderInput,
): Promise<SendBookingReminderOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    sendBookingReminderInStore(data, input, actor),
  );
}

/** Cancels a booking, releasing its seats and rooming. */
export function cancelGroupBooking(
  input: CancelBookingInput,
): Promise<CancelBookingOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    cancelGroupBookingInStore(data, input, actor),
  );
}

/** Corrects a booking's primary contact name and phone. */
export function updateGroupBookingContact(
  input: EditBookingInput,
): Promise<EditBookingOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    updateBookingContactInStore(data, input, actor),
  );
}

/**
 * Moves a booking to another departure group.
 *
 * The only mutation that spans two groups, so both are loaded into the same
 * unit of work — the seats leaving one and arriving in the other have to be
 * written together or not at all.
 */
export function moveBookingToGroup(
  input: MoveBookingInput,
): Promise<MoveBookingOutcome> {
  return mutate([input.fromGroupId, input.toGroupId], (data, actor) =>
    moveBookingToGroupInStore(data, input, actor),
  );
}

/** Records who is actually paying for a booking. */
export function setBookingPayer(
  input: SetBookingPayerInput,
): Promise<SetBookingPayerOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    setBookingPayerInStore(data, input, actor),
  );
}

/** Adds a relationship edge (mahram, spouse, ...) between two travellers on the same booking. */
export function addTravellerRelationship(
  input: AddTravellerRelationshipInput,
): Promise<AddTravellerRelationshipOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    addTravellerRelationshipInStore(data, input, actor),
  );
}

/** Removes a previously recorded traveller relationship. */
export function removeTravellerRelationship(
  input: RemoveTravellerRelationshipInput,
): Promise<RemoveTravellerRelationshipOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    removeTravellerRelationshipInStore(data, input, actor),
  );
}

/* ── Flights ──────────────────────────────────────────────────────────────── */

/** Creates or edits a flight sector. */
export function upsertGroupFlight(
  input: UpsertFlightInput,
): Promise<UpsertFlightOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    upsertFlightInStore(data, input, actor),
  );
}

/**
 * Creates or edits a flight sector and appends any new transit legs in one
 * atomic unit — the whole chain is pre-validated before anything commits, so
 * either the sector and every stop land together, or nothing does.
 */
export function upsertGroupFlightWithLegs(
  input: UpsertFlightWithLegsInput,
): Promise<UpsertFlightOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    upsertFlightWithLegsInStore(data, input, actor),
  );
}

/** Appends a transit leg to a flight. */
export function addGroupFlightLeg(
  input: AddFlightLegInput,
): Promise<AddFlightLegOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    addFlightLegInStore(data, input, actor),
  );
}

/** Corrects an already-saved transit leg's own fields. */
export function updateGroupFlightLeg(
  input: UpdateFlightLegInput,
): Promise<UpdateFlightLegOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    updateFlightLegInStore(data, input, actor),
  );
}

/** Removes one transit leg from a flight's itinerary. */
export function removeGroupFlightLeg(
  input: RemoveFlightLegInput,
): Promise<RemoveFlightLegOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    removeFlightLegInStore(data, input, actor),
  );
}

/** Attaches a PNR / booking code to a flight. */
export function recordGroupFlightTicketing(
  input: FlightTicketingInput,
): Promise<FlightTicketingOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    recordFlightTicketingInStore(data, input, actor),
  );
}

/** Bulk-flips a flight's held seats to ticketed. */
export function markGroupFlightTicketsIssued(
  input: MarkFlightTicketsIssuedInput,
): Promise<MarkFlightTicketsIssuedOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    markFlightTicketsIssuedInStore(data, input, actor),
  );
}

/** Flags or clears a per-traveller ticketing problem (name mismatch, change). */
export function flagGroupPilgrimFlightIssue(
  input: FlagPilgrimFlightIssueInput,
): Promise<FlagPilgrimFlightIssueOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    flagPilgrimFlightIssueInStore(data, input, actor),
  );
}

/** Attaches an uploaded ticket file to one pilgrim ("Upload Ticket"). */
export async function uploadGroupPilgrimTicket(
  input: RecordTicketUploadInput,
): Promise<RecordTicketUploadOutcome> {
  const fileCheck = await checkAttachedFile(input.filePath);
  if (!fileCheck.ok) return { ok: false, error: fileCheck.error };
  return mutate([input.departureGroupId], (data, actor) =>
    recordTicketUploadInStore(data, input, actor),
  );
}

/**
 * Runs the AI ticket review against the pilgrim's own name/passport and the
 * group's actual booked flight(s), then records the outcome. Two separate
 * writes rather than one — the model call happens outside any `mutate()`
 * load/diff/persist window, the same reason `documents-ai.ts` writes its
 * results with a direct update rather than folding a network call into the
 * store-mutation cycle. Never throws: an unconfigured or failing review comes
 * back as `{ok:false}` in the returned outcome, same as a caller checking a
 * validation error.
 */
export async function analyseGroupPilgrimTicket(
  departureGroupId: string,
  pilgrimId: string,
): Promise<TicketVisaAiOutcome> {
  const supabase = await db();
  const data = await loadStore(supabase, {
    groupIds: [departureGroupId],
    only: ["groups", "pilgrims", "flights"],
  });

  const pilgrim = data.pilgrims.find((p) => p.id === pilgrimId);
  if (!pilgrim || !pilgrim.ticket_file_path) {
    return {
      ok: false,
      extracted: {},
      issues: [],
      error: "No ticket is on file for this pilgrim.",
    };
  }

  const toLeg = (direction: "OUTBOUND" | "RETURN") => {
    const flight = data.flights.find(
      (f) =>
        f.departure_group_id === departureGroupId && f.direction === direction,
    );
    return flight
      ? {
          airline: flight.airline,
          flightNumber: flight.flight_number,
          departureAt: flight.departure_at,
          originCode: flight.origin_airport_code,
          originName: flight.origin_airport_name,
          destinationCode: flight.destination_airport_code,
          destinationName: flight.destination_airport_name,
          pnr: flight.pnr,
        }
      : null;
  };

  const storage = {
    createSignedUrl: (path: string, ttl: number) =>
      supabase.storage.from("pilgrim-documents").createSignedUrl(path, ttl),
  };

  const outboundFlight = toLeg("OUTBOUND");
  const returnFlight = toLeg("RETURN");

  // Same free-first order as the bulk "Upload Tickets" flow — a single
  // "Upload Ticket" click on a real digital PDF should never need a model
  // call just because it happens to be reviewed one pilgrim at a time.
  const freeExtraction = await extractTicketIdentityFromPdf(storage, {
    filePath: pilgrim.ticket_file_path,
    fileName: pilgrim.ticket_file_name ?? "ticket.pdf",
  });

  let result: TicketVisaAiOutcome;
  if (freeExtraction.ok) {
    const nameConfirmed = freeExtraction.passengerNames.some(
      (name) =>
        matchExtractedNameToPilgrims(name, [
          { pilgrimId: pilgrim.id, fullName: pilgrim.full_name_snapshot },
        ]) !== null,
    );
    const issues = freeTicketIssues(
      freeExtraction.rawText,
      freeExtraction.flightNumbers,
      outboundFlight,
      returnFlight,
    );
    if (!nameConfirmed) {
      issues.unshift({
        code: "NAME_MISMATCH",
        severity: "WARNING",
        message: freeExtraction.passengerNames.length > 0
          ? `Name(s) on the ticket (${freeExtraction.passengerNames.join(", ")}) don't clearly match ${pilgrim.full_name_snapshot} on file.`
          : `Could not read a passenger name off this ticket to compare against ${pilgrim.full_name_snapshot}.`,
      });
    }
    // Reconciles the PNR the free extractor already read off the ticket
    // against the one recorded on the flight — the cross-check "Upload
    // Ticket / PNR" and this review never made against each other even
    // though both sides already had the value.
    const pnrIssue = pnrMismatchIssue(
      freeExtraction.pnr,
      outboundFlight?.pnr ?? returnFlight?.pnr,
    );
    if (pnrIssue) issues.push(pnrIssue);
    result = {
      ok: true,
      extracted: freeExtraction.pnr ? { PNR: freeExtraction.pnr } : {},
      issues,
      error: null,
    };
  } else if (isTicketVisaAiConfigured()) {
    result = await analyseTicket(storage, {
      filePath: pilgrim.ticket_file_path,
      fileName: pilgrim.ticket_file_name ?? "ticket",
      pilgrimName: pilgrim.full_name_snapshot,
      passportNumber: pilgrim.passport_number_snapshot,
      outboundFlight,
      returnFlight,
    });
    if (result.ok && !result.issues.some((i) => i.code === "PNR_MISMATCH")) {
      const pnrIssue = pnrMismatchIssue(
        extractedPnr(result.extracted),
        outboundFlight?.pnr ?? returnFlight?.pnr,
      );
      if (pnrIssue) result = { ...result, issues: [...result.issues, pnrIssue] };
    }
  } else {
    result = { ok: false, extracted: {}, issues: [], error: freeExtraction.error };
  }

  await mutate([departureGroupId], (data2, actor) => {
    recordTicketAiResultInStore(
      data2,
      {
        departureGroupId,
        pilgrimId,
        status: result.ok ? "COMPLETE" : "FAILED",
        extracted: result.extracted,
        issues: result.issues,
        error: result.error,
      },
      actor,
    );
    return { ok: true as const };
  });

  return result;
}

/**
 * Runs the AI visa review against the pilgrim's own name/passport and the
 * group's return date, then records the outcome. Same two-write shape as
 * `analyseGroupPilgrimTicket()` and for the same reason.
 */
export async function analyseGroupPilgrimVisa(
  departureGroupId: string,
  pilgrimId: string,
): Promise<TicketVisaAiOutcome> {
  const supabase = await db();
  const data = await loadStore(supabase, {
    groupIds: [departureGroupId],
    only: ["groups", "pilgrims"],
  });

  const group = data.groups.find((g) => g.id === departureGroupId);
  const pilgrim = data.pilgrims.find((p) => p.id === pilgrimId);
  if (!group || !pilgrim || !pilgrim.visa_file_path) {
    return {
      ok: false,
      extracted: {},
      issues: [],
      error: "No visa file is on record for this pilgrim.",
    };
  }

  const storage = {
    createSignedUrl: (path: string, ttl: number) =>
      supabase.storage.from("pilgrim-documents").createSignedUrl(path, ttl),
  };

  const result = await analyseVisa(storage, {
    filePath: pilgrim.visa_file_path,
    fileName: "visa",
    pilgrimName: pilgrim.full_name_snapshot,
    passportNumber: pilgrim.passport_number_snapshot,
    passportExpiry: pilgrim.passport_expiry,
    visaId: pilgrim.visa_id,
    groupReturnDate: group.return_date,
  });

  await mutate([departureGroupId], (data2) => {
    recordVisaAiResultInStore(data2, {
      departureGroupId,
      pilgrimId,
      status: result.ok ? "COMPLETE" : "FAILED",
      extracted: result.extracted,
      issues: result.issues,
      error: result.error,
    });
    return { ok: true as const };
  });

  return result;
}

export interface BulkTicketMatchResult {
  ok: boolean;
  /** One entry per pilgrim the ticket was filed against — a group e-ticket can name more than one. */
  matched: { pilgrimId: string; fullName: string; issues: TicketVisaAiOutcome["issues"] }[];
  /** Names the model read off the document but couldn't confidently tie to anyone on this group. */
  unmatchedNames: string[];
  error: string | null;
}

type TicketLeg = {
  airline: string;
  flightNumber: string | null;
  departureAt: string;
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  pnr: string | null;
} | null;

/**
 * The checks the free text-layer path can make without a model: does either
 * of the group's own flight numbers show up anywhere on the ticket, and — if
 * not — does the route at least show up by airport code or city/airport
 * name? Some tickets print "Colombo" rather than "CMB", so a flight number
 * that isn't found is only actually worth flagging when the route can't be
 * confirmed either way; a ticket that spells out the city but not the code
 * is not a mismatch just because the exact 3-letter code wasn't printed.
 * Silent (no issues raised) when the group hasn't booked a flight yet, or
 * when a leg has no flight number on file to check against.
 */
function freeTicketIssues(
  rawText: string,
  extractedFlightNumbers: string[],
  outboundFlight: TicketLeg,
  returnFlight: TicketLeg,
): AiReviewIssue[] {
  const normalizedExtracted = new Set(
    extractedFlightNumbers.map((n) => n.replace(/[\s-]/g, "").toUpperCase()),
  );

  const issues: AiReviewIssue[] = [];
  for (const leg of [outboundFlight, returnFlight]) {
    if (!leg?.flightNumber) continue;
    const normalized = leg.flightNumber.replace(/[\s-]/g, "").toUpperCase();
    if (normalizedExtracted.has(normalized)) continue;

    const routeConfirmed =
      locationAppears(rawText, leg.originCode, leg.originName) &&
      locationAppears(rawText, leg.destinationCode, leg.destinationName);
    if (routeConfirmed) continue;

    issues.push({
      code: "FLIGHT_DETAILS_MISMATCH",
      severity: "WARNING",
      message: `Could not find flight number ${leg.flightNumber} or its route (${leg.originCode} → ${leg.destinationCode}) anywhere on this ticket — worth a manual check.`,
    });
  }
  return issues;
}

/**
 * The engine behind "Upload Tickets" (plural): reads whichever traveller
 * name(s) are printed on one already-staged file, matches each against the
 * group's own manifest, files a copy of the ticket to every pilgrim matched,
 * and runs the same per-pilgrim review `analyseGroupPilgrimTicket()` runs —
 * so a batch upload ends up in exactly the state a human clicking "Upload
 * Ticket" on each row one at a time would have left it in, just without the
 * clicking. A name the model can't confidently place is reported back, not
 * guessed at — the caller is expected to surface it for the per-pilgrim
 * upload button instead.
 */
export async function matchAndFileGroupTicket(
  departureGroupId: string,
  stagingPath: string,
  fileName: string,
): Promise<BulkTicketMatchResult> {
  const supabase = await db();
  const data = await loadStore(supabase, {
    groupIds: [departureGroupId],
    only: ["groups", "pilgrims", "flights"],
  });

  const group = data.groups.find((g) => g.id === departureGroupId);
  if (!group) {
    return { ok: false, matched: [], unmatchedNames: [], error: "That departure group no longer exists." };
  }

  // Path building needs the actor's agency — the same tenant scoping every
  // other object in this bucket already uses (see `document-storage.ts`).
  // Checked up front, before this path is used for anything: a caller must
  // not be able to point this at another agency's object and have it copied
  // into this group's pilgrim folders.
  const actor = await currentActor();
  if (
    !stagingPath.startsWith(`${actor.agencyId}/${departureGroupId}/_ticket-intake/`) ||
    stagingPath.includes("..")
  ) {
    return { ok: false, matched: [], unmatchedNames: [], error: "That staged file reference is invalid." };
  }

  const storage = {
    createSignedUrl: (path: string, ttl: number) =>
      supabase.storage.from("pilgrim-documents").createSignedUrl(path, ttl),
  };

  // Free first: a digital ticket PDF already carries a text layer, so reading
  // that directly costs nothing and needs no model call. Only a file the
  // free method can't handle — a scanned/photographed ticket, or a PDF with
  // no text layer at all — falls back to the AI review, and only when one is
  // actually configured; otherwise it's reported for manual assignment.
  const freeExtraction = await extractTicketIdentityFromPdf(storage, {
    filePath: stagingPath,
    fileName,
  });
  const usedFreeExtraction = freeExtraction.ok && freeExtraction.passengerNames.length > 0;

  let passengerNames: string[];
  if (usedFreeExtraction) {
    passengerNames = freeExtraction.passengerNames;
  } else if (isTicketVisaAiConfigured()) {
    // Logged, not silently swallowed — falling back to a paid model call
    // without a trace of why the free path didn't work is exactly what made
    // this look like "it always uses OpenRouter" when the free method had
    // stopped running for an unrelated, fixable reason (see
    // `next.config.ts`'s `serverExternalPackages` comment).
    console.warn(
      `[ticket-matching] Free PDF extraction did not yield a name for "${fileName}" — falling back to AI. Reason: ${freeExtraction.error ?? "no passenger names found in the text layer"}`,
    );
    const aiIdentity = await extractTicketIdentity(storage, { filePath: stagingPath, fileName });
    if (!aiIdentity.ok || aiIdentity.passengerNames.length === 0) {
      return {
        ok: false,
        matched: [],
        unmatchedNames: [],
        error:
          aiIdentity.error ??
          freeExtraction.error ??
          "Could not read a passenger name off this ticket.",
      };
    }
    passengerNames = aiIdentity.passengerNames;
  } else {
    return {
      ok: false,
      matched: [],
      unmatchedNames: [],
      error:
        freeExtraction.error ??
        "Could not read a passenger name off this ticket. Use that pilgrim's own Upload Ticket button instead.",
    };
  }

  // A cancelled traveller isn't owed a ticket, and offering them as a match
  // candidate would only invite a ticket to be filed against a seat that no
  // longer exists.
  const candidates = data.pilgrims
    .filter((p) => p.departure_group_id === departureGroupId && p.seat_status !== "CANCELLED")
    .map((p) => ({ pilgrimId: p.id, fullName: p.full_name_snapshot }));

  const matchedPilgrimIds: string[] = [];
  const unmatchedNames: string[] = [];
  for (const name of passengerNames) {
    const match = matchExtractedNameToPilgrims(name, candidates);
    if (match) matchedPilgrimIds.push(match.pilgrimId);
    else unmatchedNames.push(name);
  }

  if (matchedPilgrimIds.length === 0) {
    return {
      ok: false,
      matched: [],
      unmatchedNames,
      error: `Could not confidently match this ticket to a pilgrim on this group (read: "${passengerNames.join('", "')}").`,
    };
  }

  const toLeg = (direction: "OUTBOUND" | "RETURN") => {
    const flight = data.flights.find(
      (f) => f.departure_group_id === departureGroupId && f.direction === direction,
    );
    return flight
      ? {
          airline: flight.airline,
          flightNumber: flight.flight_number,
          departureAt: flight.departure_at,
          originCode: flight.origin_airport_code,
          originName: flight.origin_airport_name,
          destinationCode: flight.destination_airport_code,
          destinationName: flight.destination_airport_name,
          pnr: flight.pnr,
        }
      : null;
  };
  const outboundFlight = toLeg("OUTBOUND");
  const returnFlight = toLeg("RETURN");

  const extension = stagingPath.split(".").pop() ?? "pdf";

  const matched: BulkTicketMatchResult["matched"] = [];
  for (const pilgrimId of matchedPilgrimIds) {
    const pilgrim = data.pilgrims.find((p) => p.id === pilgrimId);
    if (!pilgrim) continue;

    const finalFileName = `ticket.${extension}`;
    const finalPath = `${actor.agencyId}/${departureGroupId}/${pilgrimId}/${finalFileName}`;
    // A copy, not a move — a single e-ticket sometimes covers several
    // travellers on one PNR, so the same staged file may be filed to more
    // than one pilgrim before the staging original is removed below.
    const { error: copyError } = await supabase.storage
      .from("pilgrim-documents")
      .copy(stagingPath, finalPath);
    if (copyError) {
      matched.push({ pilgrimId, fullName: pilgrim.full_name_snapshot, issues: [] });
      continue;
    }

    await mutate([departureGroupId], (data2, actor2) =>
      recordTicketUploadInStore(
        data2,
        { departureGroupId, pilgrimId, filePath: finalPath, fileName: finalFileName },
        actor2,
      ),
    );

    let reviewIssues: AiReviewIssue[];
    let reviewExtracted: Record<string, string>;
    if (usedFreeExtraction) {
      // Stay free end to end: no model call for the review either, just the
      // facts the text layer can actually confirm — whether either of the
      // group's own flight numbers shows up anywhere on this ticket, and
      // whether the PNR it read off the ticket matches the flight's own.
      reviewIssues = freeTicketIssues(
        freeExtraction.rawText,
        freeExtraction.flightNumbers,
        outboundFlight,
        returnFlight,
      );
      const pnrIssue = pnrMismatchIssue(
        freeExtraction.pnr,
        outboundFlight?.pnr ?? returnFlight?.pnr,
      );
      if (pnrIssue) reviewIssues.push(pnrIssue);
      reviewExtracted = freeExtraction.pnr ? { PNR: freeExtraction.pnr } : {};

      await mutate([departureGroupId], (data2, actor2) => {
        recordTicketAiResultInStore(
          data2,
          {
            departureGroupId,
            pilgrimId,
            status: "COMPLETE",
            extracted: reviewExtracted,
            issues: reviewIssues,
            error: null,
          },
          actor2,
        );
        return { ok: true as const };
      });
    } else {
      const review = await analyseTicket(storage, {
        filePath: finalPath,
        fileName: finalFileName,
        pilgrimName: pilgrim.full_name_snapshot,
        passportNumber: pilgrim.passport_number_snapshot,
        outboundFlight,
        returnFlight,
      });
      reviewIssues = review.issues;
      reviewExtracted = review.extracted;
      if (review.ok && !reviewIssues.some((i) => i.code === "PNR_MISMATCH")) {
        const pnrIssue = pnrMismatchIssue(
          extractedPnr(review.extracted),
          outboundFlight?.pnr ?? returnFlight?.pnr,
        );
        if (pnrIssue) reviewIssues = [...reviewIssues, pnrIssue];
      }

      await mutate([departureGroupId], (data2, actor2) => {
        recordTicketAiResultInStore(
          data2,
          {
            departureGroupId,
            pilgrimId,
            status: review.ok ? "COMPLETE" : "FAILED",
            extracted: reviewExtracted,
            issues: reviewIssues,
            error: review.error,
          },
          actor2,
        );
        return { ok: true as const };
      });
    }

    matched.push({ pilgrimId, fullName: pilgrim.full_name_snapshot, issues: reviewIssues });
  }

  // The staged original is never left behind once every match has been
  // filed — an unattributed leftover in `_ticket-intake/` is exactly the
  // ambiguity this whole flow exists to avoid.
  await supabase.storage.from("pilgrim-documents").remove([stagingPath]);

  return { ok: true, matched, unmatchedNames, error: null };
}

/* ── Seat holds & waitlist ────────────────────────────────────────────────── */

/**
 * Every group with at least one `HELD` booking whose hold has expired —
 * candidates for `releaseGroupExpiredSeatHolds()`, not a guarantee every one
 * still qualifies once the mutator re-checks it (a hold with money against
 * it is never released; see `releaseExpiredSeatHoldsInStore`). Scoped to the
 * partial index this table already carries
 * (`departure_group_bookings_hold_expiry_idx`).
 */
export async function listGroupIdsWithExpiredSeatHolds(
  client?: Db,
): Promise<string[]> {
  const supabase = await db(client);
  const { data, error } = await supabase
    .from("departure_group_bookings")
    .select("departure_group_id")
    .eq("booking_status", "HELD")
    .lt("seat_hold_expires_at", new Date().toISOString());
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.departure_group_id as string))];
}

/**
 * Sweeps expired seat holds for one group.
 *
 * Exposed as its own mutation so it can be driven by a schedule
 * (`app/api/cron/release-seat-holds/route.ts`) as well as by the group
 * screen's own action.
 */
export function releaseGroupExpiredSeatHolds(
  departureGroupId: string,
  options?: { client?: Db; actor?: GroupActor },
): Promise<{ ok: true; result: ReleaseExpiredHoldsResult }> {
  return mutate(
    [departureGroupId],
    (data) => ({
      ok: true as const,
      result: releaseExpiredSeatHoldsInStore(data, departureGroupId),
    }),
    options,
  );
}

/** Promotes the longest-waiting booking into a freed seat. */
export function promoteGroupWaitlistBooking(input: {
  departureGroupId: string;
  bookingId?: string;
}): Promise<PromoteWaitlistOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    promoteWaitlistBookingInStore(data, input, actor),
  );
}

/* ── Accommodation & rooming ─────────────────────────────────────────────── */

/** Adds a new accommodation block to a group. */
export function createGroupAccommodation(
  input: CreateAccommodationInput,
): Promise<CreateAccommodationOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    createAccommodationInStore(data, input, actor),
  );
}

/** Edits an accommodation block's own details. */
export function updateGroupAccommodation(
  input: UpdateAccommodationInput,
): Promise<UpdateAccommodationOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    updateAccommodationInStore(data, input, actor),
  );
}

/** Attaches a voucher link to an accommodation. */
export function setGroupAccommodationVoucher(input: {
  id: string;
  departureGroupId: string;
  voucherUrl: string;
}): Promise<AccommodationTouchOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    setAccommodationVoucherInStore(data, input, actor),
  );
}

/** Sets an accommodation's booking reference and/or supplier name. */
export function setGroupAccommodationReference(input: {
  id: string;
  departureGroupId: string;
  bookingReference?: string;
  supplierName?: string;
  supplierId?: string | null;
}): Promise<AccommodationTouchOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    setAccommodationReferenceInStore(data, input, actor),
  );
}

/**
 * Syncs an accommodation's `internal_cost` to a linked supplier commitment's
 * amount. Called by `createCommitment()` (lib/data/suppliers-repository.ts);
 * not exposed as a standalone UI action.
 */
export function setGroupAccommodationInternalCost(input: {
  id: string;
  departureGroupId: string;
  internalCost: number;
}): Promise<AccommodationTouchOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    setAccommodationInternalCostInStore(data, input, actor),
  );
}

/** Marks an accommodation block confirmed. */
export function markGroupAccommodationConfirmed(input: {
  id: string;
  departureGroupId: string;
}): Promise<AccommodationTouchOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    markAccommodationConfirmedInStore(data, input, actor),
  );
}

/** Assigns one pilgrim to one room. */
export function assignGroupPilgrimToRoom(
  input: AssignRoomInput,
): Promise<AssignRoomOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    assignPilgrimToRoomInStore(data, input, actor),
  );
}

/** Bulk-fills every unassigned pilgrim into available rooms. */
export function autoAssignGroupRooms(
  input: AutoAssignRoomsInput,
): Promise<AutoAssignRoomsOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    autoAssignRoomsInStore(data, input, actor),
  );
}

/** Creates the physical room inventory for an accommodation block. */
export function generateGroupRooms(
  input: GenerateRoomsInput,
): Promise<GenerateRoomsOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    generateRoomsInStore(data, input, actor),
  );
}

/** Reverts a LOCKED room assignment back to ASSIGNED. */
export function unlockGroupPilgrimRoomAssignment(
  input: UnlockRoomAssignmentInput,
): Promise<UnlockRoomAssignmentOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    unlockPilgrimRoomAssignmentInStore(data, input, actor),
  );
}

/** Edits one room's own details. */
export function updateGroupRoom(
  input: UpdateRoomInput,
): Promise<UpdateRoomOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    updateRoomInStore(data, input, actor),
  );
}

/** Deletes an empty room. */
export function deleteGroupRoom(
  input: DeleteRoomInput,
): Promise<DeleteRoomOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    deleteRoomInStore(data, input, actor),
  );
}

/* ── Transport ────────────────────────────────────────────────────────────── */

/** Creates or edits a transport route. */
export function upsertGroupTransport(
  input: UpsertTransportInput,
): Promise<UpsertTransportOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    upsertTransportInStore(data, input, actor),
  );
}

/** Attaches a confirmation link to a transport route. */
export function setGroupTransportConfirmation(input: {
  id: string;
  departureGroupId: string;
  confirmationUrl: string;
}): Promise<TransportTouchOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    setTransportConfirmationInStore(data, input, actor),
  );
}

/** Sets a transport route's booking reference and/or supplier name. */
export function setGroupTransportReference(input: {
  id: string;
  departureGroupId: string;
  bookingReference?: string;
  supplierName?: string;
  supplierId?: string | null;
}): Promise<TransportTouchOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    setTransportReferenceInStore(data, input, actor),
  );
}

/**
 * Syncs a transport route's `internal_cost` to a linked supplier
 * commitment's amount. Called by `createCommitment()`
 * (lib/data/suppliers-repository.ts); not exposed as a standalone UI action.
 */
export function setGroupTransportInternalCost(input: {
  id: string;
  departureGroupId: string;
  internalCost: number;
}): Promise<TransportTouchOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    setTransportInternalCostInStore(data, input, actor),
  );
}

/** Marks a transport route confirmed. */
export function markGroupTransportConfirmed(input: {
  id: string;
  departureGroupId: string;
}): Promise<TransportTouchOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    markTransportConfirmedInStore(data, input, actor),
  );
}

/* ── Documents & visa ─────────────────────────────────────────────────────── */

/** Marks a pilgrim's documents verified. */
export async function submitGroupPilgrimDocument(
  input: SubmitDocumentInput,
): Promise<DocumentOutcome> {
  const fileCheck = await checkAttachedFile(input.filePath);
  if (!fileCheck.ok) return { ok: false, error: fileCheck.error };
  return mutate([input.departureGroupId], (data, actor) =>
    submitPilgrimDocumentInStore(data, input, actor),
  );
}

/**
 * Signs off one document.
 *
 * The acting role is resolved here rather than trusted from the caller, because
 * the template's `verified_by_role` is only meaningful if it is checked against
 * who is actually clicking.
 */
export async function verifyGroupPilgrimDocument(
  input: VerifyDocumentInput,
): Promise<DocumentOutcome> {
  const { role } = await getCurrentStaffRole();
  return mutate([input.departureGroupId], (data, actor) =>
    verifyPilgrimDocumentInStore(data, input, actor, role),
  );
}

/** Sends one named document back with a reason. */
export async function rejectGroupPilgrimDocument(
  input: RejectDocumentInput,
): Promise<DocumentOutcome> {
  const { role } = await getCurrentStaffRole();
  return mutate([input.departureGroupId], (data, actor) =>
    rejectPilgrimDocumentInStore(data, input, actor, role),
  );
}

/** Marks a requirement inapplicable to one traveller. */
export async function waiveGroupPilgrimDocument(
  input: WaiveDocumentInput,
): Promise<DocumentOutcome> {
  const { role } = await getCurrentStaffRole();
  return mutate([input.departureGroupId], (data, actor) =>
    waivePilgrimDocumentInStore(data, input, actor, role),
  );
}

/** Captures the traveller facts the derivable requirements are checked against. */
export function updateGroupPilgrimRecord(
  input: UpdatePilgrimRecordInput,
): Promise<UpdatePilgrimRecordOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    updatePilgrimRecordInStore(data, input, actor),
  );
}

/** Bulk-lodges eligible pilgrims' visa applications. */
export function markGroupApplicationsSubmitted(input: {
  departureGroupId: string;
  pilgrimIds: string[];
}): Promise<MarkApplicationsSubmittedOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    markApplicationsSubmittedInStore(data, input, actor),
  );
}

/** Moves lodged applications into the consulate's review queue. */
export function markGroupVisasUnderReview(input: {
  departureGroupId: string;
  pilgrimIds: string[];
  note?: string | null;
}) {
  return mutate([input.departureGroupId], (data, actor) =>
    markVisaUnderReviewInStore(data, input, actor),
  );
}

/** Records an issued visa for one pilgrim. */
export async function uploadGroupPilgrimVisa(
  input: UploadVisaInput,
): Promise<VisaDecisionOutcome> {
  const fileCheck = await checkAttachedFile(input.filePath);
  if (!fileCheck.ok) return { ok: false, error: fileCheck.error };
  return mutate([input.departureGroupId], (data, actor) =>
    uploadPilgrimVisaInStore(data, input, actor),
  );
}

/** Records a refused visa — the transition the module previously could not make. */
export function rejectGroupPilgrimVisa(
  input: RejectVisaInput,
): Promise<VisaDecisionOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    rejectPilgrimVisaInStore(data, input, actor),
  );
}

/* ── Readiness & tasks ────────────────────────────────────────────────────── */

/** Applies one edit to a readiness requirement. */
export function updateGroupReadinessItem(
  input: UpdateReadinessItemInput,
): Promise<UpdateReadinessItemOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    updateReadinessItemInStore(data, input, actor),
  );
}

/** Creates a task against a group. */
export function createGroupTask(
  input: CreateGroupTaskInput,
): Promise<CreateGroupTaskOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    createGroupTaskInStore(data, input, actor),
  );
}

/** Moves a task through its lifecycle. */
export function updateGroupTaskStatus(
  input: Parameters<typeof updateGroupTaskStatusInStore>[1],
): Promise<UpdateGroupTaskStatusOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    updateGroupTaskStatusInStore(data, input, actor),
  );
}

/** Changes a task's owner, including clearing it back to unassigned. */
export function reassignGroupTask(
  input: ReassignGroupTaskInput,
): Promise<ReassignGroupTaskOutcome> {
  return mutate([input.departureGroupId], (data, actor) =>
    reassignGroupTaskInStore(data, input, actor),
  );
}

/** Applies a status and/or owner change to many tasks — possibly across
 *  several groups — in one unit of work. */
export function bulkUpdateGroupTasks(
  input: BulkUpdateGroupTasksInput,
): Promise<BulkUpdateGroupTasksOutcome> {
  const groupIds = [...new Set(input.taskRefs.map((r) => r.departureGroupId))];
  return mutate(groupIds, (data, actor) =>
    bulkUpdateGroupTasksInStore(data, input, actor),
  );
}

/* ── Group lifecycle ──────────────────────────────────────────────────────── */

/**
 * Edits a group's own details.
 *
 * The group code is unique across every group including archived ones, and the
 * store only holds the group being edited, so that one check is made against
 * the database before the mutator runs.
 */
export async function updateGroupDetails(
  input: UpdateGroupDetailsInput,
): Promise<UpdateGroupDetailsOutcome> {
  const code = input.groupCode?.trim();
  if (code) {
    const supabase = await db();
    const { data, error } = await supabase
      .from("departure_groups")
      .select("id")
      .ilike("group_code", code)
      .neq("id", input.groupId)
      .limit(1);

    if (error) throw error;
    if ((data ?? []).length > 0) {
      return {
        ok: false,
        error: `Group code ${code.toUpperCase()} is already in use.`,
      };
    }
  }

  return mutate([input.groupId], (data, actor) =>
    updateGroupDetailsInStore(data, input, actor),
  );
}

/** Applies a group-level lifecycle transition. */
export async function setGroupLifecycle(input: {
  groupId: string;
  action: GroupLifecycleAction;
  reason?: string;
}): Promise<GroupLifecycleOutcome> {
  // Supplier commitments are the authoritative payable ledger. Keep closure
  // from declaring a group fully settled while an eligible supplier balance
  // remains open; the pure lifecycle mutator intentionally owns only group,
  // booking, and traveller rows.
  if (input.action === "CLOSE_GROUP") {
    const supabase = await db();
    const { data, error } = await supabase
      .from("finance_supplier_payable_rows")
      .select("outstanding_amount, currency")
      .eq("departure_group_id", input.groupId)
      .gt("outstanding_amount", 0);
    if (error) throw error;
    const open = (data ?? []) as { outstanding_amount: number; currency: string }[];
    if (open.length > 0) {
      const byCurrency = new Map<string, number>();
      for (const row of open) {
        const currency = row.currency || "LKR";
        byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + Number(row.outstanding_amount || 0));
      }
      const summary = [...byCurrency.entries()]
        .map(([currency, amount]) => `${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${currency}`)
        .join(", ");
      return { ok: false, error: `Supplier payables remain open (${summary}). Settle or explicitly write them off before closing.` };
    }
  }
  return mutate([input.groupId], (data, actor) =>
    setGroupLifecycleInStore(data, input, actor),
  );
}

/**
 * Thrown when a template id resolves to nothing — a real `packages` row that
 * has been deleted, or an id that was never valid. `createDepartureGroup`
 * turns this into a friendly `{ ok: false }` result; nothing should ever
 * catch it silently and substitute other data.
 */
export class TemplateNotFoundError extends Error {
  constructor(templateId: string) {
    super(`Package template "${templateId}" could not be resolved.`);
    this.name = "TemplateNotFoundError";
  }
}

/**
 * Resolves a template id to the full definition the copy engine needs.
 *
 * UUIDs only — a uuid id is a real `packages` row and MUST be loaded from
 * the database (silently substituting a seeded fixture here was the bug
 * that made every Departure Group created from a real package copy demo
 * pricing, itinerary and requirements instead of the package the user
 * actually picked). This used to also look a non-uuid id up in
 * `TEMPLATE_LIBRARY` — the seeded demo library's readable keys, e.g.
 * `pkg-umrah-standard-2026` — as a fallback, but the live picker
 * (`listPackageTemplateOptions()`) only ever offers real `packages` rows,
 * so the only way a non-uuid id could reach this function in production was
 * a crafted request straight at the Server Action, which would then
 * silently create a REAL departure group built from placeholder demo
 * content. `TEMPLATE_LIBRARY` still exists for seed scripts and evals
 * (`lib/agent/departure-ops/__evals__/fixtures.ts`), which read it
 * directly rather than through group creation — it was never a legitimate
 * runtime fallback for this function. See
 * docs/modules/packages-production-readiness-plan.md, finding C9.
 */
async function resolveTemplate(
  templateId: string,
  client?: Db,
): Promise<PackageTemplateDefinition> {
  if (!isUuid(templateId)) throw new TemplateNotFoundError(templateId);

  const live = await loadTemplateDefinition(templateId, client);
  if (live) return live;
  throw new TemplateNotFoundError(templateId);
}

export { DEFAULT_COPY_OPTIONS };
