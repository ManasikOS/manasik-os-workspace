"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { capabilitiesForPackages } from "@/lib/access/packages-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { IMPORT_MAX_ROWS_PER_CALL } from "@/lib/import/chunked-import";
import { consumeInboxRateLimit } from "@/lib/inbox/rate-limit/limiter";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  checkBookingCancellationRights,
  checkBookingCommercialTerms,
  type BookingCommercialTermsInput,
} from "@/lib/data/departure-groups-booking-terms";
import {
  addGroupFlightLeg,
  addPilgrimCharge,
  addTravellerRelationship,
  removeTravellerRelationship,
  setBookingPayer,
  analyseGroupPilgrimTicket,
  analyseGroupPilgrimVisa,
  approvePilgrimCharge,
  cancelPilgrimDeviation,
  matchAndFileGroupTicket,
  decidePilgrimDeviation,
  markPilgrimDeviationArranged,
  requestPilgrimCustomisation,
  requestPilgrimDeviation,
  setPilgrimBaseFare,
  setPilgrimRoomType,
  voidPilgrimCharge,
  assignGroupPilgrimToRoom,
  autoAssignGroupRooms,
  cancelGroupBooking,
  eraseTravellerSensitiveData,
  changeBookingRoomPreference,
  createDepartureGroup,
  createGroupBooking,
  createGroupTask,
  flagGroupPilgrimFlightIssue,
  generateGroupCode,
  generateGroupRooms,
  getCurrentDepartureCapabilities,
  getCurrentStaffRole,
  isGroupCodeTaken,
  loadMoreGroupActivity,
  markGroupAccommodationConfirmed,
  markGroupApplicationsSubmitted,
  markGroupFlightTicketsIssued,
  markGroupTransportConfirmed,
  markGroupVisasUnderReview,
  moveBookingToGroup,
  promoteGroupWaitlistBooking,
  recordBookingPayment,
  recordGroupFlightTicketing,
  rejectGroupPilgrimDocument,
  rejectGroupPilgrimVisa,
  releaseGroupExpiredSeatHolds,
  removeGroupFlightLeg,
  sendBookingReminder,
  submitGroupPilgrimDocument,
  updateGroupBookingContact,
  updateGroupFlightLeg,
  updateGroupPilgrimRecord,
  verifyGroupPilgrimDocument,
  waiveGroupPilgrimDocument,
  setGroupAccommodationReference,
  setGroupAccommodationVoucher,
  setGroupArchived,
  setGroupLifecycle,
  setGroupTransportConfirmation,
  setGroupTransportReference,
  createGroupAccommodation,
  updateGroupAccommodation,
  updateGroupDetails,
  updateGroupReadinessItem,
  updateGroupTaskStatus,
  deleteGroupRoom,
  unlockGroupPilgrimRoomAssignment,
  updateGroupRoom,
  uploadGroupPilgrimTicket,
  uploadGroupPilgrimVisa,
  upsertGroupFlightWithLegs,
  upsertGroupTransport,
} from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { confirmLinkedCommitmentBestEffort, syncCommitmentForLinkedEntity } from "@/lib/data/suppliers-repository";
import { flagSeasonalGuidesForReview, resolveStaffIdByName } from "@/lib/data/team-repository";
import { getAgencySettings } from "@/lib/data/settings-repository";
import { agencyAssetSignedUrl } from "@/app/(main)/management/settings/branding/logo-storage";
import { createClient } from "@/utils/supabase/server";
import type {
  DepartureGroupStatus,
  DocumentStatus,
  FlightDirection,
  GroupSalesStatus,
  PilgrimFlightStatus,
  PilgrimVisaStatus,
  ReadinessItemStatus,
  RoomType,
  TaskStatus,
} from "@/lib/types/departure-groups";
import type {
  GroupActivityLog,
  PilgrimCharge,
  PilgrimDeviation,
} from "@/app/(main)/departure-groups/types";
import {
  accommodationReferenceSchema,
  accommodationVoucherSchema,
  addChargeSchema,
  addFlightLegSchema,
  addTravellerRelationshipSchema,
  removeTravellerRelationshipSchema,
  setBookingPayerSchema,
  removeFlightLegSchema,
  updateFlightLegSchema,
  approveChargeSchema,
  assignRoomSchema,
  autoAssignRoomsSchema,
  bookingReminderSchema,
  cancelBookingSchema,
  cancelDeviationSchema,
  changeRoomPreferenceSchema,
  decideDeviationSchema,
  eraseTravellerDataSchema,
  createDepartureGroupSchema,
  createGroupTaskSchema,
  deleteRoomSchema,
  editBookingSchema,
  flagFlightIssueSchema,
  flightTicketingSchema,
  generateGroupCodeSchema,
  generateRoomsSchema,
  groupBookingSchema,
  groupLifecycleSchema,
  markAccommodationConfirmedSchema,
  markApplicationsSubmittedSchema,
  markDeviationArrangedSchema,
  markFlightTicketsIssuedSchema,
  markTransportConfirmedSchema,
  markVisasUnderReviewSchema,
  moveBookingSchema,
  promoteWaitlistSchema,
  recordPaymentSchema,
  rejectDocumentSchema,
  rejectVisaSchema,
  releaseExpiredHoldsSchema,
  requestDeviationSchema,
  requestDeviationWithChargeSchema,
  setBaseFareSchema,
  setPilgrimRoomTypeSchema,
  submitDocumentSchema,
  toDepartureGroupFieldErrors,
  updatePilgrimRecordSchema,
  verifyDocumentSchema,
  voidChargeSchema,
  waiveDocumentSchema,
  transportConfirmationSchema,
  transportReferenceSchema,
  transportSchema,
  unlockRoomAssignmentSchema,
  createAccommodationSchema,
  updateAccommodationSchema,
  updateGroupDetailsSchema,
  updateGroupTaskStatusSchema,
  updateReadinessItemSchema,
  updateRoomSchema,
  uploadTicketSchema,
  uploadVisaSchema,
  upsertFlightSchema,
  type DepartureGroupFieldErrors,
} from "@/lib/validations/departure-groups";

/**
 * Mutations for Departure Groups.
 *
 * Server Actions are public POST endpoints, so each one re-authenticates,
 * re-checks the caller's role and re-validates its payload rather than trusting
 * that the UI gated the call.
 */

export type CreateGroupResult =
  | { ok: true; groupId: string; packageName: string }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Creating a departure group sits across two modules' capabilities — the
 * Departure Groups module's own `createGroup`, checked at every call site
 * already, and the Packages module's `createGroupFromPackage`, which was
 * never checked here at all. For every BUILT-IN role the two happen to
 * agree (both true only for ADMIN/OPERATIONS today), so this was invisible
 * — but `capabilitiesForPackages(role)` is now merged with a custom role's
 * saved `role_permissions` overrides (see `requirePackageCapability()` in
 * app/(main)/packages/actions.ts), and nothing stopped an ADMIN from
 * granting a custom role `departure_groups.createGroup` without also
 * granting `packages.createGroupFromPackage` — that role could still
 * create groups regardless. This module's own capabilities
 * (`capabilitiesFor(role)` above) are not yet wired to
 * `role_permissions` the same way; fixing that is its own, separate
 * module's production-readiness work, not part of this check. See
 * docs/modules/packages-production-readiness-plan.md, Phase 3 item 3.
 */
async function requireCreateGroupFromPackageCapability(
  role: Awaited<ReturnType<typeof getCurrentStaffRole>>["role"],
  roleId: Awaited<ReturnType<typeof getCurrentStaffRole>>["roleId"],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient(await cookies());
  const can = await loadDynamicCapabilities(
    supabase,
    roleId,
    "packages",
    capabilitiesForPackages(role),
  );
  if (!can.createGroupFromPackage) {
    return { ok: false, error: "Your role cannot create departure groups from a package." };
  }
  return { ok: true };
}

export async function createDepartureGroupAction(
  input: unknown,
): Promise<CreateGroupResult> {
  await requireUser();

  const { role, roleId } = await getCurrentStaffRole();
  if (!(await getCurrentDepartureCapabilities()).createGroup) {
    return {
      ok: false,
      error: "Your role cannot create departure groups.",
    };
  }
  const packagesGate = await requireCreateGroupFromPackageCapability(role, roleId);
  if (!packagesGate.ok) return { ok: false, error: packagesGate.error };

  const parsed = createDepartureGroupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;

  // Uniqueness is not expressible in the schema — check it against the store.
  if (await isGroupCodeTaken(data.groupCode)) {
    return {
      ok: false,
      error: `Group code ${data.groupCode} is already in use.`,
      fieldErrors: { groupCode: ["That group code is already in use."] },
    };
  }

  // Creating a group from a template that is not open for sale is an Admin-only
  // escape hatch, and the result is always a PLANNING group.
  //
  // This check is only a fast, field-level error for the honest case —
  // `allowDraftTemplate` is a client-supplied flag, so it is not itself the
  // security boundary: a non-admin could previously bypass it entirely by
  // simply not setting it, because nothing downstream ever checked the
  // package's REAL status. `createDepartureGroup()` now re-derives this
  // from the package's actual `status` column and the caller's real,
  // server-resolved role — see its own comment — so this block is
  // redundant with, not a substitute for, that check. See
  // docs/modules/packages-production-readiness-plan.md, finding A2.
  if (data.allowDraftTemplate && role !== "ADMIN") {
    return {
      ok: false,
      error:
        "Only an administrator can start a planning group from a draft template.",
    };
  }

  const outcome = await createDepartureGroup(
    {
      packageTemplateId: data.packageTemplateId,
      groupName: data.groupName,
      groupCode: data.groupCode,
      departureDate: data.departureDate,
      returnDate: data.returnDate,
      capacity: data.capacity,
      minimumGroupSize: data.minimumGroupSize,
      salesStatus: data.salesStatus,
      branch: data.branch,
      operationsOwnerName: data.operationsOwnerName,
      primaryGuideName: data.primaryGuideName,
      waitlistEnabled: data.waitlistEnabled,
      seatHoldExpiryHours: data.seatHoldExpiryHours,
      copyOptions: data.copyOptions,
      pricing: data.pricing,
      costEstimate: data.costEstimate,
      flightRouting: data.flightRouting,
    }
  );
  if (!outcome.ok) {
    return { ok: false, error: outcome.error, fieldErrors: { groupCode: [outcome.error] } };
  }

  revalidatePath("/departure-groups");
  return { ok: true, ...outcome.result };
}

export interface ActiveSupplierOption {
  id: string;
  name: string;
  supplierType: string;
}

export type ListActiveSuppliersResult =
  | { ok: true; suppliers: ActiveSupplierOption[] }
  | { ok: false; error: string };

/**
 * Options for a hotel/transport/flight's supplier picker. A plain read of
 * active suppliers — any signed-in staff member with module access can see
 * the directory's names, the same posture as picking a package template.
 *
 * `supplierTypes`, when given, narrows the list to the types that actually
 * make sense for the field asking (a hotel picker has no business offering
 * an insurance broker) — see SUPPLIER_TYPES_BY_CONTEXT in
 * `[groupId]/components/supplier-picker.tsx` for the exact lists per
 * context. Omitted entirely, this returns every active supplier — used only
 * by screens with no single obvious type (none today).
 */
export async function listActiveSuppliersAction(
  supplierTypes?: string[],
): Promise<ListActiveSuppliersResult> {
  await requireUser();
  if (!(await getCurrentDepartureCapabilities()).viewModule) {
    return { ok: false, error: "Your role cannot view suppliers." };
  }

  const supabase = createClient(await cookies());
  let query = supabase
    .from("suppliers")
    .select("id, name, supplier_type")
    .eq("status", "ACTIVE")
    .order("name", { ascending: true });
  if (supplierTypes && supplierTypes.length > 0) {
    query = query.in("supplier_type", supplierTypes);
  }
  const { data, error } = await query;

  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    suppliers: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      supplierType: row.supplier_type,
    })),
  };
}

export type GenerateGroupCodeResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

/**
 * Suggests the next free group code for the create form. The field is
 * read-only in the UI, so this is the only way a code reaches it — the caller
 * still re-checks uniqueness against the store at submit time.
 */
export async function generateGroupCodeAction(
  input: unknown,
): Promise<GenerateGroupCodeResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).createGroup) {
    return { ok: false, error: "Your role cannot create departure groups." };
  }

  const parsed = generateGroupCodeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Pick a template and departure date first." };
  }

  const code = await generateGroupCode(
    parsed.data.journeyType,
    parsed.data.departureDate,
  );
  return { ok: true, code };
}

/* ── Bulk import ──────────────────────────────────────────────────────────── */

export interface ImportRowResult {
  rowNumber: number;
  groupCode: string;
  ok: boolean;
  groupId?: string;
  error?: string;
}

export type ImportGroupsResult =
  | { ok: true; created: number; total: number; results: ImportRowResult[] }
  | { ok: false; error: string };

/**
 * Creates many groups from parsed CSV rows in one call.
 *
 * The client has already mapped and previewed the rows, but this re-validates
 * every one — a Server Action cannot trust its input — and enforces group-code
 * uniqueness across both the store AND the rest of this batch (each successful
 * create lands in the store immediately, so `isGroupCodeTaken` catches an
 * in-file duplicate on the next iteration). Valid rows are created even when
 * others fail, and every row's outcome is reported back.
 */
export async function importDepartureGroupsAction(
  input: unknown,
): Promise<ImportGroupsResult> {
  const user = await requireUser();

  const { role, roleId, agencyId } = await getCurrentStaffRole();
  if (!(await getCurrentDepartureCapabilities()).createGroup) {
    return { ok: false, error: "Your role cannot import departure groups." };
  }
  const packagesGate = await requireCreateGroupFromPackageCapability(role, roleId);
  if (!packagesGate.ok) return { ok: false, error: packagesGate.error };

  if (!Array.isArray(input)) {
    return { ok: false, error: "No rows were received to import." };
  }
  if (input.length === 0) {
    return { ok: false, error: "There are no valid rows to import." };
  }
  // The import screen sends the file in small batches; a bigger call is a hand-made one.
  if (input.length > IMPORT_MAX_ROWS_PER_CALL) {
    return {
      ok: false,
      error: `Send at most ${IMPORT_MAX_ROWS_PER_CALL} groups per request.`,
    };
  }
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };

  const allowance = await consumeInboxRateLimit(createAdminClient(), {
    agencyId,
    userId: user.id,
    action: "IMPORT_DEPARTURE_GROUPS",
  });
  if (!allowance.ok) return { ok: false, error: allowance.error };

  const results: ImportRowResult[] = [];
  let created = 0;

  for (let i = 0; i < input.length; i++) {
    const rowNumber = i + 1;
    const parsed = createDepartureGroupSchema.safeParse(input[i]);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? "This row is not valid.";
      results.push({
        rowNumber,
        groupCode: readGroupCode(input[i]),
        ok: false,
        error: firstError,
      });
      continue;
    }

    const data = parsed.data;

    // Fast, row-level error only — see the identical check's comment in
    // `createDepartureGroupAction` above. `createDepartureGroup()` is the
    // actual enforcement point and re-derives this from the package's real
    // status regardless of what this row's `allowDraftTemplate` says.
    if (data.allowDraftTemplate && role !== "ADMIN") {
      results.push({
        rowNumber,
        groupCode: data.groupCode,
        ok: false,
        error: "Only an administrator can import from a draft template.",
      });
      continue;
    }

    if (await isGroupCodeTaken(data.groupCode)) {
      results.push({
        rowNumber,
        groupCode: data.groupCode,
        ok: false,
        error: `Group code ${data.groupCode} is already in use.`,
      });
      continue;
    }

    const outcome = await createDepartureGroup(
      {
        packageTemplateId: data.packageTemplateId,
        groupName: data.groupName,
        groupCode: data.groupCode,
        departureDate: data.departureDate,
        returnDate: data.returnDate,
        capacity: data.capacity,
        minimumGroupSize: data.minimumGroupSize,
        salesStatus: data.salesStatus,
        branch: data.branch,
        operationsOwnerName: data.operationsOwnerName,
        primaryGuideName: data.primaryGuideName,
        waitlistEnabled: data.waitlistEnabled,
        seatHoldExpiryHours: data.seatHoldExpiryHours,
        copyOptions: data.copyOptions,
        pricing: data.pricing,
        costEstimate: data.costEstimate,
        flightRouting: data.flightRouting,
      }
    );

    if (!outcome.ok) {
      // The per-row `isGroupCodeTaken()` check above and this write are not
      // one atomic step — a concurrent create (another admin's single-group
      // form, or a second bulk import) can still take the code in between.
      results.push({
        rowNumber,
        groupCode: data.groupCode,
        ok: false,
        error: outcome.error,
      });
      continue;
    }

    created++;
    results.push({
      rowNumber,
      groupCode: data.groupCode,
      ok: true,
      groupId: outcome.result.groupId,
    });
  }

  if (created > 0) revalidatePath("/departure-groups");
  return { ok: true, created, total: input.length, results };
}

/** Best-effort code read for error rows that failed schema parsing. */
function readGroupCode(row: unknown): string {
  if (row && typeof row === "object" && "groupCode" in row) {
    const code = (row as { groupCode?: unknown }).groupCode;
    if (typeof code === "string" && code.trim()) return code.toUpperCase();
  }
  return "—";
}

/* ── Add booking ──────────────────────────────────────────────────────────── */

export type CreateBookingResult =
  | {
      ok: true;
      bookingId: string;
      bookingReference: string;
      travellerCount: number;
    }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Price, paid amount and starting status come from the client, so they are
 * checked here against the caller's real capabilities and the group's own
 * published rates — see `checkBookingCommercialTerms`.
 */
async function checkNewBookingTerms(
  role: Awaited<ReturnType<typeof getCurrentStaffRole>>["role"],
  departureGroupId: string,
  terms: BookingCommercialTermsInput,
) {
  const can = await getCurrentDepartureCapabilities();
  let pricing = null;
  if (!can.overrideCapacityAndPrice) {
    const supabase = createClient(await cookies());
    const { data, error } = await supabase
      .from("departure_group_pricing")
      .select("*")
      .eq("departure_group_id", departureGroupId)
      .maybeSingle();
    if (error) throw error;
    pricing = data;
  }
  return checkBookingCommercialTerms(terms, pricing, {
    overrideCapacityAndPrice: can.overrideCapacityAndPrice,
    recordPayments: can.recordPayments,
  });
}

export async function createGroupBookingAction(
  input: unknown,
): Promise<CreateBookingResult> {
  await requireUser();

  const { role } = await getCurrentStaffRole();
  if (!(await getCurrentDepartureCapabilities()).addBookings) {
    return { ok: false, error: "Your role cannot add bookings." };
  }

  const parsed = groupBookingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;

  const termsCheck = await checkNewBookingTerms(role, data.departureGroupId, data);
  if (!termsCheck.ok) {
    return {
      ok: false,
      error: termsCheck.error,
      fieldErrors: { [termsCheck.field]: [termsCheck.error] },
    };
  }

  const outcome = await createGroupBooking(
    {
      departureGroupId: data.departureGroupId,
      leadId: data.leadId ?? null,
      bookingReference: data.bookingReference,
      bookingStatus: data.bookingStatus,
      primaryContactName: data.primaryContactName,
      primaryContactPhone: data.primaryContactPhone,
      travellerCount: data.travellerCount,
      roomOccupancyPreference: data.roomOccupancyPreference,
      packagePricePerPerson: data.packagePricePerPerson,
      amountPaid: data.amountPaid,
      seatHoldExpiresAt: data.seatHoldExpiresAt ?? null,
      travellers: data.travellers,
    }
  );

  if (!outcome.ok) {
    // Seat/capacity failures point the user at the traveller-count field.
    return {
      ok: false,
      error: outcome.error,
      fieldErrors: { travellerCount: [outcome.error] },
    };
  }

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/* ── Import pilgrims into a group ─────────────────────────────────────────── */

export interface ImportBookingRowResult {
  /** 1-based position among the bookings in the file. */
  bookingNumber: number;
  bookingReference: string;
  primaryContactName: string;
  travellerCount: number;
  ok: boolean;
  error?: string;
}

export type ImportPilgrimsResult =
  | {
      ok: true;
      createdBookings: number;
      createdTravellers: number;
      totalBookings: number;
      results: ImportBookingRowResult[];
    }
  | { ok: false; error: string };

/**
 * Creates many bookings — each with its travellers — against one group from
 * parsed spreadsheet rows.
 *
 * The client has already grouped the rows into bookings and previewed them, but
 * every payload is re-validated here, and each booking goes through the same
 * `createGroupBooking` path as the Add Booking form, so capacity, seat
 * reconciliation and the document checklist behave identically. Bookings are
 * created in file order and a failure does not stop the rest: seats run out
 * part-way through a large file often enough that "create what fits and report
 * the rest" is the only useful behaviour.
 */
export async function importGroupPilgrimsAction(
  input: unknown,
): Promise<ImportPilgrimsResult> {
  const user = await requireUser();

  const { role, agencyId } = await getCurrentStaffRole();
  if (!(await getCurrentDepartureCapabilities()).addBookings) {
    return { ok: false, error: "Your role cannot import pilgrims." };
  }

  if (!Array.isArray(input)) {
    return { ok: false, error: "No rows were received to import." };
  }
  if (input.length === 0) {
    return { ok: false, error: "There are no valid bookings to import." };
  }
  // The import screen sends the file in small batches; a bigger call is a hand-made one.
  if (input.length > IMPORT_MAX_ROWS_PER_CALL) {
    return { ok: false, error: `Send at most ${IMPORT_MAX_ROWS_PER_CALL} bookings per request.` };
  }
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };

  const allowance = await consumeInboxRateLimit(createAdminClient(), {
    agencyId,
    userId: user.id,
    action: "IMPORT_GROUP_BOOKINGS",
  });
  if (!allowance.ok) return { ok: false, error: allowance.error };

  const results: ImportBookingRowResult[] = [];
  const touchedGroups = new Set<string>();
  let createdBookings = 0;
  let createdTravellers = 0;

  for (let i = 0; i < input.length; i++) {
    const bookingNumber = i + 1;
    const parsed = groupBookingSchema.safeParse(input[i]);

    if (!parsed.success) {
      results.push({
        bookingNumber,
        bookingReference: readBookingReference(input[i]),
        primaryContactName: readPrimaryContactName(input[i]),
        travellerCount: 0,
        ok: false,
        error: parsed.error.issues[0]?.message ?? "This booking is not valid.",
      });
      continue;
    }

    const data = parsed.data;

    const termsCheck = await checkNewBookingTerms(role, data.departureGroupId, data);
    if (!termsCheck.ok) {
      results.push({
        bookingNumber,
        bookingReference: data.bookingReference,
        primaryContactName: data.primaryContactName,
        travellerCount: data.travellerCount,
        ok: false,
        error: termsCheck.error,
      });
      continue;
    }

    const outcome = await createGroupBooking(
      {
        departureGroupId: data.departureGroupId,
        leadId: data.leadId ?? null,
        bookingReference: data.bookingReference,
        bookingStatus: data.bookingStatus,
        primaryContactName: data.primaryContactName,
        primaryContactPhone: data.primaryContactPhone,
        travellerCount: data.travellerCount,
        roomOccupancyPreference: data.roomOccupancyPreference,
        packagePricePerPerson: data.packagePricePerPerson,
        amountPaid: data.amountPaid,
        seatHoldExpiresAt: data.seatHoldExpiresAt ?? null,
        travellers: data.travellers,
      }
    );

    if (!outcome.ok) {
      results.push({
        bookingNumber,
        bookingReference: data.bookingReference,
        primaryContactName: data.primaryContactName,
        travellerCount: data.travellerCount,
        ok: false,
        error: outcome.error,
      });
      continue;
    }

    createdBookings++;
    createdTravellers += outcome.result.travellerCount;
    touchedGroups.add(data.departureGroupId);
    results.push({
      bookingNumber,
      // The store re-numbers a reference that was already taken, so echo back
      // what was actually created rather than what was asked for.
      bookingReference: outcome.result.bookingReference,
      primaryContactName: data.primaryContactName,
      travellerCount: outcome.result.travellerCount,
      ok: true,
    });
  }

  if (createdBookings > 0) {
    revalidatePath("/departure-groups");
    for (const groupId of touchedGroups) {
      revalidatePath(`/departure-groups/${groupId}`);
    }
  }

  return {
    ok: true,
    createdBookings,
    createdTravellers,
    totalBookings: input.length,
    results,
  };
}

/** Best-effort reads for rows that failed schema parsing. */
function readBookingReference(row: unknown): string {
  if (row && typeof row === "object" && "bookingReference" in row) {
    const value = (row as { bookingReference?: unknown }).bookingReference;
    if (typeof value === "string" && value.trim()) return value.toUpperCase();
  }
  return "—";
}

function readPrimaryContactName(row: unknown): string {
  if (row && typeof row === "object" && "primaryContactName" in row) {
    const value = (row as { primaryContactName?: unknown }).primaryContactName;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "—";
}

/* ── Record payment ───────────────────────────────────────────────────────── */

export type RecordPaymentResult =
  | {
      ok: true;
      bookingReference: string;
      amountPaid: number;
      outstandingBalance: number;
      paidInFull: boolean;
    }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

export async function recordBookingPaymentAction(
  input: unknown,
): Promise<RecordPaymentResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).recordPayments) {
    return { ok: false, error: "Your role cannot record payments." };
  }

  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await recordBookingPayment(
    {
      bookingId: data.bookingId,
      departureGroupId: data.departureGroupId,
      amount: data.amount,
      method: data.method,
      note: data.note,
    }
  );

  if (!outcome.ok) {
    return {
      ok: false,
      error: outcome.error,
      fieldErrors: { amount: [outcome.error] },
    };
  }

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return {
    ok: true,
    bookingReference: outcome.result.bookingReference,
    amountPaid: outcome.result.amountPaid,
    outstandingBalance: outcome.result.outstandingBalance,
    paidInFull: outcome.result.paidInFull,
  };
}

/* ── Change room preference ───────────────────────────────────────────────── */

export type ChangeRoomPreferenceResult =
  | {
      ok: true;
      bookingReference: string;
      travellerCount: number;
      previousPreference: RoomType;
      roomOccupancyPreference: RoomType;
      repriced: boolean;
      packagePricePerPerson: number;
      totalBookingValue: number;
      outstandingBalance: number;
      releasedRoomAssignments: number;
      lockedRoomAssignments: number;
    }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Moves a booking to a different room occupancy tier.
 *
 * Two capabilities are checked, not one: rooming to change the preference, and
 * pricing to accept a new per-person rate alongside it. A rooming-only role
 * (Operations, Visa) can retier a booking but never reprice it — the request is
 * refused rather than silently stripped, so the caller knows the money was not
 * touched.
 */
export async function changeRoomPreferenceAction(
  input: unknown,
): Promise<ChangeRoomPreferenceResult> {
  await requireUser();

  const can = await getCurrentDepartureCapabilities();
  if (!can.manageRooming) {
    return { ok: false, error: "Your role cannot change room preferences." };
  }

  const parsed = changeRoomPreferenceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;

  if (data.pricePerPerson !== undefined && !can.overrideCapacityAndPrice) {
    return {
      ok: false,
      error:
        "Your role cannot reprice a booking. Change the occupancy without repricing, or ask an administrator.",
      fieldErrors: {
        pricePerPerson: ["Your role cannot change the package price."],
      },
    };
  }

  const outcome = await changeBookingRoomPreference(
    {
      bookingId: data.bookingId,
      departureGroupId: data.departureGroupId,
      roomOccupancyPreference: data.roomOccupancyPreference,
      pricePerPerson: data.pricePerPerson,
      releaseRoomAssignments: data.releaseRoomAssignments,
      note: data.note,
    }
  );

  if (!outcome.ok) {
    return { ok: false, error: outcome.error };
  }

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/* ── Reminders ────────────────────────────────────────────────────────────── */

export type SendReminderResult =
  | {
      ok: true;
      bookingReference: string;
      kind: "PAYMENT" | "DOCUMENT";
      channel: "WHATSAPP" | "SMS" | "EMAIL";
      recipientName: string;
      recipientPhone: string;
      recordedAt: string;
    }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Records a payment or document reminder for a booking.
 *
 * No message leaves the system — there is no gateway wired up — so this writes
 * the reminder to the activity trail and the UI hands the operator the draft to
 * send. Composing the draft is the client's job: a role without finance access
 * gets one that names no amounts, which is why this only needs the
 * communications capability.
 */
export async function sendBookingReminderAction(
  input: unknown,
): Promise<SendReminderResult> {
  await requireUser();

  const can = await getCurrentDepartureCapabilities();
  if (!can.sendGroupCommunications) {
    return {
      ok: false,
      error: "Your role cannot send reminders to pilgrims.",
    };
  }

  const parsed = bookingReminderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;

  const outcome = await sendBookingReminder(
    {
      bookingId: data.bookingId,
      departureGroupId: data.departureGroupId,
      kind: data.kind,
      channel: data.channel,
      message: data.message,
      recipientName: data.recipientName,
      recipientPhone: data.recipientPhone,
    }
  );

  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/* ── Cancel a booking ─────────────────────────────────────────────────────── */

export type CancelBookingResult =
  | {
      ok: true;
      bookingReference: string;
      travellerCount: number;
      seatsReleased: number;
      releasedRoomAssignments: number;
      amountPaid: number;
      refundAmount: number;
      availableSeats: number;
    }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Cancels a booking, releasing its seats and rooming.
 *
 * Gated on `addBookings` — the role that may create a booking is the role that
 * may withdraw one — and a refund figure additionally needs `recordPayments`,
 * since it commits the agency to paying money back.
 */
export async function cancelGroupBookingAction(
  input: unknown,
): Promise<CancelBookingResult> {
  await requireUser();

  const can = await getCurrentDepartureCapabilities();
  if (!can.cancelBookings) {
    return { ok: false, error: "Your role cannot cancel bookings." };
  }

  const parsed = cancelBookingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;

  // Money already on the booking is decided server-side from the stored row,
  // never from anything the client says about it.
  const { data: bookingRow, error: bookingLookupError } = await createClient(
    await cookies(),
  )
    .from("departure_group_bookings")
    .select("amount_paid")
    .eq("id", data.bookingId)
    .eq("departure_group_id", data.departureGroupId)
    .maybeSingle();
  if (bookingLookupError) throw bookingLookupError;
  if (!bookingRow) {
    return { ok: false, error: "That booking no longer exists." };
  }
  const rights = checkBookingCancellationRights(
    { cancelBookings: can.cancelBookings, recordPayments: can.recordPayments },
    Number((bookingRow as { amount_paid: number | null }).amount_paid ?? 0),
  );
  if (!rights.ok) return { ok: false, error: rights.error };

  if (data.refundAmount !== undefined && data.refundAmount > 0 && !can.recordPayments) {
    return {
      ok: false,
      error:
        "Your role cannot commit a refund. Cancel without one and ask finance to raise it.",
      fieldErrors: {
        refundAmount: ["Your role cannot record a refund."],
      },
    };
  }

  const outcome = await cancelGroupBooking(
    {
      bookingId: data.bookingId,
      departureGroupId: data.departureGroupId,
      reason: data.reason,
      refundAmount: data.refundAmount,
    }
  );

  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return {
    ok: true,
    bookingReference: outcome.result.bookingReference,
    travellerCount: outcome.result.travellerCount,
    seatsReleased: outcome.result.seatsReleased,
    releasedRoomAssignments: outcome.result.releasedRoomAssignments,
    amountPaid: outcome.result.amountPaid,
    refundAmount: outcome.result.refundAmount,
    availableSeats: outcome.result.availableSeats,
  };
}

/* ── Edit a booking's contact details ─────────────────────────────────────── */

export type EditBookingResult =
  | { ok: true; bookingReference: string; primaryContactName: string; primaryContactPhone: string }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Corrects a booking's primary contact name and phone — the one pair of
 * fields captured at "Add Booking" time with no way to fix a typo afterwards.
 * Gated on `addBookings`, the same capability that gates creating and
 * cancelling a booking.
 */
export async function updateBookingContactAction(
  input: unknown,
): Promise<EditBookingResult> {
  await requireUser();

  const can = await getCurrentDepartureCapabilities();
  if (!can.addBookings) {
    return { ok: false, error: "Your role cannot edit bookings." };
  }

  const parsed = editBookingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await updateGroupBookingContact(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return {
    ok: true,
    bookingReference: outcome.result.bookingReference,
    primaryContactName: outcome.result.primaryContactName,
    primaryContactPhone: outcome.result.primaryContactPhone,
  };
}

/* ── Booking payer ─────────────────────────────────────────────────────────── */

export type SetBookingPayerResult =
  | {
      ok: true;
      bookingReference: string;
      payerName: string | null;
      payerEmail: string | null;
      bookingType: "GROUP" | "CUSTOM";
    }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Records who is actually paying for a booking, when that differs from the
 * on-the-ground primary contact. Gated on `addBookings`, the same capability
 * that gates creating and editing a booking.
 */
export async function setBookingPayerAction(
  input: unknown,
): Promise<SetBookingPayerResult> {
  await requireUser();

  const can = await getCurrentDepartureCapabilities();
  if (!can.addBookings) {
    return { ok: false, error: "Your role cannot edit bookings." };
  }

  const parsed = setBookingPayerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const outcome = await setBookingPayer(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  revalidatePath("/bookings");
  return {
    ok: true,
    bookingReference: outcome.result.bookingReference,
    payerName: outcome.result.payerName,
    payerEmail: outcome.result.payerEmail,
    bookingType: outcome.result.bookingType,
  };
}

/* ── Traveller relationships ──────────────────────────────────────────────── */

export type AddTravellerRelationshipResult =
  | { ok: true; id: string; fromName: string; toName: string }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Records a relationship edge (mahram, spouse, ...) between two travellers on
 * the same booking. Gated on `addBookings` — the same capability that gates
 * every other change to a booking's own record.
 */
export async function addTravellerRelationshipAction(
  input: unknown,
): Promise<AddTravellerRelationshipResult> {
  await requireUser();

  const can = await getCurrentDepartureCapabilities();
  if (!can.addBookings) {
    return { ok: false, error: "Your role cannot edit bookings." };
  }

  const parsed = addTravellerRelationshipSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const outcome = await addTravellerRelationship(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return {
    ok: true,
    id: outcome.result.id,
    fromName: outcome.result.fromName,
    toName: outcome.result.toName,
  };
}

export type RemoveTravellerRelationshipResult =
  | { ok: true }
  | { ok: false; error: string };

export async function removeTravellerRelationshipAction(
  input: unknown,
): Promise<RemoveTravellerRelationshipResult> {
  await requireUser();

  const can = await getCurrentDepartureCapabilities();
  if (!can.addBookings) {
    return { ok: false, error: "Your role cannot edit bookings." };
  }

  const parsed = removeTravellerRelationshipSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That relationship could not be identified." };
  }

  const outcome = await removeTravellerRelationship(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true };
}

/* ── Move a booking to another group ──────────────────────────────────────── */

export type MoveBookingResult =
  | {
      ok: true;
      bookingReference: string;
      previousReference: string;
      travellerCount: number;
      fromGroupName: string;
      toGroupId: string;
      toGroupName: string;
      toGroupCode: string;
      repriced: boolean;
      packagePricePerPerson: number;
      totalBookingValue: number;
      outstandingBalance: number;
      releasedRoomAssignments: number;
      targetAvailableSeats: number;
    }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Moves a booking to another departure group.
 *
 * Gated on `editGroupDetails` — this rewrites the seat counts of two groups, not
 * just one booking — and, as with a retier, a new per-person rate additionally
 * needs a pricing capability. Both groups are revalidated: the booking has left
 * one manifest and joined another.
 */
export async function moveBookingToGroupAction(
  input: unknown,
): Promise<MoveBookingResult> {
  await requireUser();

  const can = await getCurrentDepartureCapabilities();
  if (!can.editGroupDetails) {
    return {
      ok: false,
      error: "Your role cannot move bookings between departure groups.",
    };
  }

  const parsed = moveBookingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;

  if (data.pricePerPerson !== undefined && !can.overrideCapacityAndPrice) {
    return {
      ok: false,
      error:
        "Your role cannot reprice a booking. Move it without repricing, or ask an administrator.",
      fieldErrors: {
        pricePerPerson: ["Your role cannot change the package price."],
      },
    };
  }

  const outcome = await moveBookingToGroup(
    {
      bookingId: data.bookingId,
      fromGroupId: data.fromGroupId,
      toGroupId: data.toGroupId,
      pricePerPerson: data.pricePerPerson,
      reissueReference: data.reissueReference,
      note: data.note,
    }
  );

  if (!outcome.ok) {
    return { ok: false, error: outcome.error };
  }

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.fromGroupId}`);
  revalidatePath(`/departure-groups/${data.toGroupId}`);
  return { ok: true, ...outcome.result };
}

/* ── Archive / restore ────────────────────────────────────────────────────── */

export type ArchiveResult =
  | { ok: true; groupName: string }
  | { ok: false; error: string };

async function setArchived(
  groupId: unknown,
  archived: boolean,
): Promise<ArchiveResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).cancelOrArchiveGroup) {
    return {
      ok: false,
      error: `Your role cannot ${archived ? "archive" : "restore"} departure groups.`,
    };
  }

  if (typeof groupId !== "string" || !groupId.trim()) {
    return { ok: false, error: "That group reference is invalid." };
  }

  const result = await setGroupArchived(groupId, archived);
  if (!result) {
    return { ok: false, error: "That departure group no longer exists." };
  }

  revalidatePath("/departure-groups");
  return { ok: true, groupName: result.groupName };
}

export async function archiveDepartureGroupAction(
  groupId: unknown,
): Promise<ArchiveResult> {
  return setArchived(groupId, true);
}

export async function restoreDepartureGroupAction(
  groupId: unknown,
): Promise<ArchiveResult> {
  return setArchived(groupId, false);
}

/* ── Flights ──────────────────────────────────────────────────────────────── */

export type UpsertFlightResult =
  | { ok: true; flightId: string; direction: FlightDirection; created: boolean }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/** Creates or edits a flight sector (Outbound / Return). */
export async function upsertGroupFlightAction(
  input: unknown,
): Promise<UpsertFlightResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageFlights) {
    return { ok: false, error: "Your role cannot manage flights." };
  }

  const parsed = upsertFlightSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await upsertGroupFlightWithLegs({
    id: data.id,
    departureGroupId: data.departureGroupId,
    direction: data.direction,
    status: data.status,
    airline: data.airline,
    flightNumber: data.flightNumber,
    pnr: data.pnr,
    bookingReference: data.bookingReference,
    originAirportCode: data.originAirportCode,
    originAirportName: data.originAirportName,
    destinationAirportCode: data.destinationAirportCode,
    destinationAirportName: data.destinationAirportName,
    departureAt: data.departureAt,
    arrivalAt: data.arrivalAt,
    departureLocalDate: data.departureLocalDate,
    arrivalLocalDate: data.arrivalLocalDate,
    cabinClass: data.cabinClass,
    seatCapacity: data.seatCapacity,
    seatsHeld: data.seatsHeld,
    ticketingDeadline: data.ticketingDeadline,
    supplierName: data.supplierName,
    notes: data.notes,
    newLegs: data.newLegs,
  });

  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type AddFlightLegResult =
  | { ok: true; legId: string; legOrder: number }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/** Appends one transit leg to a flight's itinerary. */
export async function addGroupFlightLegAction(
  input: unknown,
): Promise<AddFlightLegResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageFlights) {
    return { ok: false, error: "Your role cannot manage flights." };
  }

  const parsed = addFlightLegSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await addGroupFlightLeg(
    {
      flightId: data.flightId,
      departureGroupId: data.departureGroupId,
      airline: data.airline,
      flightNumber: data.flightNumber,
      originAirportCode: data.originAirportCode,
      destinationAirportCode: data.destinationAirportCode,
      departureAt: data.departureAt,
      arrivalAt: data.arrivalAt,
    }
  );

  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type UpdateFlightLegResult =
  | { ok: true; legId: string }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/** Corrects an already-saved transit leg's own fields. */
export async function updateGroupFlightLegAction(
  input: unknown,
): Promise<UpdateFlightLegResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageFlights) {
    return { ok: false, error: "Your role cannot manage flights." };
  }

  const parsed = updateFlightLegSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const outcome = await updateGroupFlightLeg(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type RemoveFlightLegResult =
  | { ok: true; removedLegOrder: number }
  | { ok: false; error: string };

/** Removes one transit leg from a flight's itinerary. */
export async function removeGroupFlightLegAction(
  input: unknown,
): Promise<RemoveFlightLegResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageFlights) {
    return { ok: false, error: "Your role cannot manage flights." };
  }

  const parsed = removeFlightLegSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That transit leg reference is invalid." };
  }

  const outcome = await removeGroupFlightLeg(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type FlightTicketingResult =
  | { ok: true; flightId: string; pnr: string; bookingReference: string | null }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/** Attaches a PNR / booking code to a flight ("Upload Ticket / PNR"). */
export async function recordFlightTicketingAction(
  input: unknown,
): Promise<FlightTicketingResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageFlights) {
    return { ok: false, error: "Your role cannot manage flights." };
  }

  const parsed = flightTicketingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await recordGroupFlightTicketing(
    {
      flightId: data.flightId,
      departureGroupId: data.departureGroupId,
      pnr: data.pnr,
      bookingReference: data.bookingReference,
    }
  );

  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type MarkFlightTicketsIssuedResult =
  | {
      ok: true;
      flightId: string;
      direction: FlightDirection;
      seatsTicketed: number;
      pilgrimsUpdated: number;
    }
  | { ok: false; error: string };

/** Bulk-flips a flight's held seats to ticketed ("Mark Tickets Issued"). */
export async function markFlightTicketsIssuedAction(
  input: unknown,
): Promise<MarkFlightTicketsIssuedResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageFlights) {
    return { ok: false, error: "Your role cannot manage flights." };
  }

  const parsed = markFlightTicketsIssuedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That flight reference is invalid." };
  }

  const data = parsed.data;
  const outcome = await markGroupFlightTicketsIssued(
    { flightId: data.flightId, departureGroupId: data.departureGroupId }
  );

  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/* ── Accommodation & rooming ─────────────────────────────────────────────── */

/**
 * Keeps a hotel/route's Supplier Commitment in step whenever its supplier
 * link is set or changed from the group side — see
 * `syncCommitmentForLinkedEntity()`'s own doc comment for why this exists.
 * Best-effort: a failure here must never fail the save that already
 * succeeded, mirroring `createCommitment()`'s own internal_cost sync.
 */
async function syncCommitmentBestEffort(input: {
  supplierId: string | null | undefined;
  departureGroupId: string;
  linkedEntityType: "ACCOMMODATION" | "TRANSPORT";
  linkedEntityId: string;
  serviceLabel: string;
  actorId: string | null;
  actorName: string;
}): Promise<void> {
  if (!input.supplierId) return;
  try {
    const supabase = createClient(await cookies());
    await syncCommitmentForLinkedEntity(
      supabase,
      {
        supplierId: input.supplierId,
        departureGroupId: input.departureGroupId,
        linkedEntityType: input.linkedEntityType,
        linkedEntityId: input.linkedEntityId,
        // Deliberately coarse (ACCOMMODATION_OTHER / OTHER) rather than an
        // extra query to look up the accommodation's city — this link is
        // what makes status/cost sync work at all; the exact service-
        // category bucket is a label staff can refine in Suppliers.
        serviceCategory: input.linkedEntityType === "ACCOMMODATION" ? "ACCOMMODATION_OTHER" : "OTHER",
        serviceLabel: input.serviceLabel,
      },
      { id: input.actorId, name: input.actorName },
    );
  } catch (error) {
    console.error(
      `[departure-groups] failed to sync supplier commitment for ${input.linkedEntityType} ${input.linkedEntityId}:`,
      error,
    );
  }
}

/** Best-effort mirror of `syncCommitmentBestEffort` for the confirm step — see `confirmLinkedCommitmentBestEffort()`'s own doc comment. */
async function confirmLinkedCommitmentSafely(input: {
  linkedEntityType: "ACCOMMODATION" | "TRANSPORT";
  linkedEntityId: string;
  actorId: string | null;
  actorName: string;
}): Promise<void> {
  try {
    const supabase = createClient(await cookies());
    await confirmLinkedCommitmentBestEffort(
      supabase,
      { linkedEntityType: input.linkedEntityType, linkedEntityId: input.linkedEntityId },
      { id: input.actorId, name: input.actorName },
    );
  } catch (error) {
    console.error(
      `[departure-groups] failed to confirm linked commitment for ${input.linkedEntityType} ${input.linkedEntityId}:`,
      error,
    );
  }
}

export type AccommodationResult =
  | { ok: true; hotelName: string }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Adds a new accommodation block to a group ("Add Hotel"). This exists so a
 * group whose package-copy checklist skipped accommodation still has a way
 * to add hotels afterward — the copy checklist only decides what gets copied
 * in at creation, not what can ever be added later.
 */
export async function createAccommodationAction(
  input: unknown,
): Promise<AccommodationResult> {
  const user = await requireUser();

  const { name, staffId } = await getCurrentStaffRole();
  if (!(await getCurrentDepartureCapabilities()).manageAccommodation) {
    return { ok: false, error: "Your role cannot manage accommodation." };
  }

  const parsed = createAccommodationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await createGroupAccommodation(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await syncCommitmentBestEffort({
    supplierId: data.supplierId,
    departureGroupId: data.departureGroupId,
    linkedEntityType: "ACCOMMODATION",
    linkedEntityId: outcome.result.id,
    serviceLabel: outcome.result.hotelName,
    actorId: staffId ?? user.id,
    actorName: name ?? "Staff",
  });

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, hotelName: outcome.result.hotelName };
}

/** Edits an accommodation block's own details. */
export async function updateAccommodationAction(
  input: unknown,
): Promise<AccommodationResult> {
  const user = await requireUser();

  const { name, staffId } = await getCurrentStaffRole();
  if (!(await getCurrentDepartureCapabilities()).manageAccommodation) {
    return { ok: false, error: "Your role cannot manage accommodation." };
  }

  const parsed = updateAccommodationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await updateGroupAccommodation(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await syncCommitmentBestEffort({
    supplierId: data.supplierId,
    departureGroupId: data.departureGroupId,
    linkedEntityType: "ACCOMMODATION",
    linkedEntityId: data.id,
    serviceLabel: outcome.result.hotelName,
    actorId: staffId ?? user.id,
    actorName: name ?? "Staff",
  });

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/** Attaches a voucher link to an accommodation ("Upload Voucher"). */
export async function setAccommodationVoucherAction(
  input: unknown,
): Promise<AccommodationResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageAccommodation) {
    return { ok: false, error: "Your role cannot manage accommodation." };
  }

  const parsed = accommodationVoucherSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await setGroupAccommodationVoucher(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/** Sets an accommodation's booking reference ("Add Booking Reference"). */
export async function setAccommodationReferenceAction(
  input: unknown,
): Promise<AccommodationResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageAccommodation) {
    return { ok: false, error: "Your role cannot manage accommodation." };
  }

  const parsed = accommodationReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await setGroupAccommodationReference(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/** Marks an accommodation block confirmed ("Mark Confirmed"). */
export async function markAccommodationConfirmedAction(
  input: unknown,
): Promise<AccommodationResult> {
  const user = await requireUser();

  const { name, staffId } = await getCurrentStaffRole();
  if (!(await getCurrentDepartureCapabilities()).manageAccommodation) {
    return { ok: false, error: "Your role cannot manage accommodation." };
  }

  const parsed = markAccommodationConfirmedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That accommodation reference is invalid." };
  }

  const data = parsed.data;
  const outcome = await markGroupAccommodationConfirmed(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await confirmLinkedCommitmentSafely({
    linkedEntityType: "ACCOMMODATION",
    linkedEntityId: data.id,
    actorId: staffId ?? user.id,
    actorName: name ?? "Staff",
  });

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type AssignRoomResult =
  | {
      ok: true;
      pilgrimName: string;
      roomLabel: string;
      previousRoomLabel: string | null;
    }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/** Assigns one pilgrim to one room ("Assign Manually"). */
export async function assignPilgrimToRoomAction(
  input: unknown,
): Promise<AssignRoomResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageRooming) {
    return { ok: false, error: "Your role cannot manage rooming." };
  }

  const parsed = assignRoomSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await assignGroupPilgrimToRoom(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type AutoAssignRoomsResult =
  | { ok: true; assigned: number; skipped: number; typeMismatched: number }
  | { ok: false; error: string };

/** Bulk-fills every unassigned pilgrim into available rooms ("Auto Assign Rooms"). */
export async function autoAssignRoomsAction(
  input: unknown,
): Promise<AutoAssignRoomsResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageRooming) {
    return { ok: false, error: "Your role cannot manage rooming." };
  }

  const parsed = autoAssignRoomsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That departure group reference is invalid." };
  }

  const data = parsed.data;
  const outcome = await autoAssignGroupRooms(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type GenerateRoomsResult =
  | { ok: true; created: number; hotelName: string }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/** Creates the physical room inventory for an accommodation block ("Generate Rooms"). */
export async function generateRoomsAction(
  input: unknown,
): Promise<GenerateRoomsResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageAccommodation) {
    return { ok: false, error: "Your role cannot manage accommodation." };
  }

  const parsed = generateRoomsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await generateGroupRooms(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, created: outcome.result.created, hotelName: outcome.result.hotelName };
}

export type UnlockRoomAssignmentResult =
  | { ok: true; pilgrimName: string }
  | { ok: false; error: string };

/** Reverts a LOCKED room assignment back to ASSIGNED ("Unlock"). */
export async function unlockRoomAssignmentAction(
  input: unknown,
): Promise<UnlockRoomAssignmentResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).unlockRoomAssignments) {
    return { ok: false, error: "Your role cannot unlock room assignments." };
  }

  const parsed = unlockRoomAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That pilgrim reference is invalid." };
  }

  const data = parsed.data;
  const outcome = await unlockGroupPilgrimRoomAssignment(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type UpdateRoomResult =
  | { ok: true; roomLabel: string }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/** Edits one room's own details ("Edit Room"). */
export async function updateRoomAction(input: unknown): Promise<UpdateRoomResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageAccommodation) {
    return { ok: false, error: "Your role cannot manage accommodation." };
  }

  const parsed = updateRoomSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await updateGroupRoom(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, roomLabel: outcome.result.roomLabel };
}

export type DeleteRoomResult =
  | { ok: true; roomLabel: string }
  | { ok: false; error: string };

/** Deletes an empty room ("Delete Room"). */
export async function deleteRoomAction(input: unknown): Promise<DeleteRoomResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageAccommodation) {
    return { ok: false, error: "Your role cannot manage accommodation." };
  }

  const parsed = deleteRoomSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That room reference is invalid." };
  }

  const data = parsed.data;
  const outcome = await deleteGroupRoom(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, roomLabel: outcome.result.roomLabel };
}

/* ── Transport ────────────────────────────────────────────────────────────── */

export type UpsertTransportResult =
  | { ok: true; transportId: string; created: boolean }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/** Creates or edits a transport route ("Add Transport Route" / "Assign Supplier"). */
export async function upsertGroupTransportAction(
  input: unknown,
): Promise<UpsertTransportResult> {
  const user = await requireUser();

  const { name, staffId } = await getCurrentStaffRole();
  if (!(await getCurrentDepartureCapabilities()).manageTransport) {
    return { ok: false, error: "Your role cannot manage transport." };
  }

  const parsed = transportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await upsertGroupTransport(
    {
      id: data.id,
      departureGroupId: data.departureGroupId,
      templateTransportRequirementId: data.templateTransportRequirementId,
      routeLabel: data.routeLabel,
      origin: data.origin,
      destination: data.destination,
      status: data.status,
      supplierName: data.supplierName,
      supplierId: data.supplierId,
      bookingReference: data.bookingReference,
      vehicleType: data.vehicleType,
      vehicleCapacity: data.vehicleCapacity,
      passengerCount: data.passengerCount,
      pickupAt: data.pickupAt,
      pickupLocation: data.pickupLocation,
      driverName: data.driverName,
      driverPhone: data.driverPhone,
      coordinatorName: data.coordinatorName,
      coordinatorPhone: data.coordinatorPhone,
      internalCost: data.internalCost,
      notes: data.notes,
    }
  );

  if (!outcome.ok) return { ok: false, error: outcome.error };

  await syncCommitmentBestEffort({
    supplierId: data.supplierId,
    departureGroupId: data.departureGroupId,
    linkedEntityType: "TRANSPORT",
    linkedEntityId: outcome.result.transportId,
    serviceLabel: data.routeLabel,
    actorId: staffId ?? user.id,
    actorName: name ?? "Staff",
  });

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type TransportTouchResult =
  | { ok: true; routeLabel: string }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/** Attaches a confirmation link to a transport route ("Upload Confirmation"). */
export async function setTransportConfirmationAction(
  input: unknown,
): Promise<TransportTouchResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageTransport) {
    return { ok: false, error: "Your role cannot manage transport." };
  }

  const parsed = transportConfirmationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await setGroupTransportConfirmation(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/** Sets a transport route's booking reference ("Add Reference"). */
export async function setTransportReferenceAction(
  input: unknown,
): Promise<TransportTouchResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageTransport) {
    return { ok: false, error: "Your role cannot manage transport." };
  }

  const parsed = transportReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await setGroupTransportReference(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/** Marks a transport route confirmed ("Mark Confirmed"). */
export async function markTransportConfirmedAction(
  input: unknown,
): Promise<TransportTouchResult> {
  const user = await requireUser();

  const { name, staffId } = await getCurrentStaffRole();
  if (!(await getCurrentDepartureCapabilities()).manageTransport) {
    return { ok: false, error: "Your role cannot manage transport." };
  }

  const parsed = markTransportConfirmedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That transport route reference is invalid." };
  }

  const data = parsed.data;
  const outcome = await markGroupTransportConfirmed(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await confirmLinkedCommitmentSafely({
    linkedEntityType: "TRANSPORT",
    linkedEntityId: data.id,
    actorId: staffId ?? user.id,
    actorName: name ?? "Staff",
  });

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/* ── Documents & visa ─────────────────────────────────────────────────────── */

/**
 * One outcome shape for every per-document mutation.
 *
 * The counters travel back with the result so the caller can render the new
 * "4 / 8" and the new visa stage without a second round trip — and so the two
 * are always the pair the server actually computed together.
 */
export type DocumentResult =
  | {
      ok: true;
      fullName: string;
      documentName: string;
      status: DocumentStatus;
      documentsCompleted: number;
      documentsRequired: number;
      visaStatus: PilgrimVisaStatus;
    }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/** Records a document received from the traveller. */
export async function submitDocumentAction(
  input: unknown,
): Promise<DocumentResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageDocumentsAndVisa) {
    return { ok: false, error: "Your role cannot manage documents and visas." };
  }

  const parsed = submitDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That document upload is invalid.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await submitGroupPilgrimDocument(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/**
 * Signs off one document.
 *
 * The role gate here is only the coarse "may touch documents at all" check —
 * whether *this* role is the one the template named as the verifier for *this*
 * requirement is enforced in the mutator, which is the only place that knows
 * which document is being signed.
 */
export async function verifyDocumentAction(
  input: unknown,
): Promise<DocumentResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageDocumentsAndVisa) {
    return { ok: false, error: "Your role cannot manage documents and visas." };
  }

  const parsed = verifyDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That document reference is invalid." };
  }

  const data = parsed.data;
  const outcome = await verifyGroupPilgrimDocument(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/** Sends one named document back with a reason. */
export async function rejectDocumentAction(
  input: unknown,
): Promise<DocumentResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageDocumentsAndVisa) {
    return { ok: false, error: "Your role cannot manage documents and visas." };
  }

  const parsed = rejectDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That rejection is invalid.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await rejectGroupPilgrimDocument(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/** Marks a requirement inapplicable to one traveller. */
export async function waiveDocumentAction(
  input: unknown,
): Promise<DocumentResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageDocumentsAndVisa) {
    return { ok: false, error: "Your role cannot manage documents and visas." };
  }

  const parsed = waiveDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That waiver is invalid.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await waiveGroupPilgrimDocument(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type UpdatePilgrimRecordResult =
  | {
      ok: true;
      fullName: string;
      changedFields: string[];
      documentsCompleted: number;
      documentsRequired: number;
      visaStatus: PilgrimVisaStatus;
    }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Captures passport expiry and the next-of-kin contact.
 *
 * These are the facts three of the template's eight requirements are actually
 * *about*, so filling them in clears those requirements automatically rather
 * than leaving someone to tick a box asserting something the CRM can see.
 */
export async function updatePilgrimRecordAction(
  input: unknown,
): Promise<UpdatePilgrimRecordResult> {
  await requireUser();

  const can = await getCurrentDepartureCapabilities();
  if (!can.manageDocumentsAndVisa || !can.viewSensitiveTravellerData) {
    return { ok: false, error: "Your role cannot edit traveller records." };
  }

  const parsed = updatePilgrimRecordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await updateGroupPilgrimRecord(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type MarkApplicationsSubmittedResult =
  | {
      ok: true;
      submittedCount: number;
      /** Named, with reasons, so the operator can act on who was left behind. */
      skipped: { fullName: string; reason: string }[];
    }
  | { ok: false; error: string };

/** Bulk-marks eligible pilgrims' visa applications submitted. */
export async function markApplicationsSubmittedAction(
  input: unknown,
): Promise<MarkApplicationsSubmittedResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageDocumentsAndVisa) {
    return { ok: false, error: "Your role cannot manage documents and visas." };
  }

  const parsed = markApplicationsSubmittedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Select at least one pilgrim to submit." };
  }

  const data = parsed.data;
  const outcome = await markGroupApplicationsSubmitted(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/** Records an issued visa for one pilgrim ("Upload Visa"). */
export async function uploadVisaAction(
  input: unknown,
): Promise<VisaDecisionResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageDocumentsAndVisa) {
    return { ok: false, error: "Your role cannot manage documents and visas." };
  }

  const parsed = uploadVisaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That visa upload is invalid.",
    };
  }

  const data = parsed.data;
  const outcome = await uploadGroupPilgrimVisa(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type VisaDecisionResult =
  | { ok: true; fullName: string; visaStatus: PilgrimVisaStatus }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

export type UploadTicketResult =
  | { ok: true; fullName: string }
  | { ok: false; error: string };

/** Attaches an uploaded ticket file to one pilgrim ("Upload Ticket"). */
export async function uploadPilgrimTicketAction(
  input: unknown,
): Promise<UploadTicketResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageFlights) {
    return { ok: false, error: "Your role cannot manage flights and tickets." };
  }

  const parsed = uploadTicketSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That ticket upload is invalid.",
    };
  }

  const outcome = await uploadGroupPilgrimTicket(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export interface AiReviewResult {
  ok: boolean;
  extracted: Record<string, string>;
  issues: { code: string; severity: "INFO" | "WARNING" | "CRITICAL"; message: string }[];
  error: string | null;
}

/**
 * Runs the AI ticket review for one pilgrim. Called right after a successful
 * upload — a separate action, not folded into `uploadPilgrimTicketAction`,
 * because the review is a model call with real latency and the upload should
 * confirm as soon as the file itself is safely recorded.
 */
export async function analysePilgrimTicketAction(
  departureGroupId: string,
  pilgrimId: string,
): Promise<AiReviewResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageFlights) {
    return {
      ok: false,
      extracted: {},
      issues: [],
      error: "Your role cannot manage flights and tickets.",
    };
  }

  const result = await analyseGroupPilgrimTicket(departureGroupId, pilgrimId);
  revalidatePath(`/departure-groups/${departureGroupId}`);
  return result;
}

/** Runs the AI visa review for one pilgrim, after a visa file has been uploaded. */
export async function analysePilgrimVisaAction(
  departureGroupId: string,
  pilgrimId: string,
): Promise<AiReviewResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageDocumentsAndVisa) {
    return {
      ok: false,
      extracted: {},
      issues: [],
      error: "Your role cannot manage documents and visas.",
    };
  }

  const result = await analyseGroupPilgrimVisa(departureGroupId, pilgrimId);
  revalidatePath(`/departure-groups/${departureGroupId}`);
  return result;
}

export interface BulkTicketMatchActionResult {
  ok: boolean;
  matched: { pilgrimId: string; fullName: string; issues: AiReviewResult["issues"] }[];
  unmatchedNames: string[];
  error: string | null;
}

/**
 * "Upload Tickets" (plural): one already-staged file, matched against the
 * group's own manifest by the name(s) printed on it, filed and reviewed
 * exactly as `uploadPilgrimTicketAction` + `analysePilgrimTicketAction` would
 * for a single pilgrim — the batch version of the same two steps, not a
 * different code path.
 */
export async function matchAndFileTicketAction(
  departureGroupId: string,
  stagingPath: string,
  fileName: string,
): Promise<BulkTicketMatchActionResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageFlights) {
    return {
      ok: false,
      matched: [],
      unmatchedNames: [],
      error: "Your role cannot manage flights and tickets.",
    };
  }

  const result = await matchAndFileGroupTicket(departureGroupId, stagingPath, fileName);
  revalidatePath(`/departure-groups/${departureGroupId}`);
  return result;
}

/**
 * Moves lodged applications into the consulate's review queue.
 *
 * `UNDER_REVIEW` had a badge, a filter and a whole subtab pointed at it, and no
 * code path that could produce it — so "Under Review" only ever listed
 * applications that had been posted and not yet acknowledged.
 */
export async function markVisasUnderReviewAction(
  input: unknown,
): Promise<{ ok: true; movedCount: number } | { ok: false; error: string }> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageDocumentsAndVisa) {
    return { ok: false, error: "Your role cannot manage documents and visas." };
  }

  const parsed = markVisasUnderReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Select at least one lodged application." };
  }

  const data = parsed.data;
  const outcome = await markGroupVisasUnderReview(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/**
 * Records a refused visa.
 *
 * This is the transition the module could not previously make at all, despite
 * `REJECTED` being a declared, rendered and filterable state — which meant the
 * event that decides whether a seat has to be released and a refund raised had
 * nowhere to be entered.
 */
export async function rejectVisaAction(
  input: unknown,
): Promise<VisaDecisionResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageDocumentsAndVisa) {
    return { ok: false, error: "Your role cannot manage documents and visas." };
  }

  const parsed = rejectVisaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That refusal is invalid.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await rejectGroupPilgrimVisa(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/* ── Seat holds & waitlist ────────────────────────────────────────────────── */

/** Sweeps seat holds whose expiry has passed, returning the seats to the group. */
export async function releaseExpiredHoldsAction(
  input: unknown,
): Promise<
  | { ok: true; releasedBookings: number; releasedSeats: number }
  | { ok: false; error: string }
> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).addBookings) {
    return { ok: false, error: "Your role cannot manage bookings." };
  }

  const parsed = releaseExpiredHoldsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That group reference is invalid." };
  }

  const data = parsed.data;
  const outcome = await releaseGroupExpiredSeatHolds(data.departureGroupId);

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return {
    ok: true,
    releasedBookings: outcome.result.releasedBookings,
    releasedSeats: outcome.result.releasedSeats,
  };
}

export type PromoteWaitlistResult =
  | {
      ok: true;
      bookingReference: string;
      primaryContactName: string;
      travellerCount: number;
      seatHoldExpiresAt: string;
      remainingWaitlist: number;
    }
  | { ok: false; error: string };

/** Promotes the longest-waiting booking into a freed seat. */
export async function promoteWaitlistAction(
  input: unknown,
): Promise<PromoteWaitlistResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).addBookings) {
    return { ok: false, error: "Your role cannot manage bookings." };
  }

  const parsed = promoteWaitlistSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That booking reference is invalid." };
  }

  const data = parsed.data;
  const outcome = await promoteGroupWaitlistBooking(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/** Flags or clears a per-traveller ticketing problem. */
export async function flagFlightIssueAction(
  input: unknown,
): Promise<
  | { ok: true; fullName: string; flightStatus: PilgrimFlightStatus }
  | { ok: false; error: string }
> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageFlights) {
    return { ok: false, error: "Your role cannot manage flights." };
  }

  const parsed = flagFlightIssueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That ticketing issue is invalid." };
  }

  const data = parsed.data;
  const outcome = await flagGroupPilgrimFlightIssue(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/* ── Readiness checklist ──────────────────────────────────────────────────── */

export type UpdateReadinessItemResult =
  | {
      ok: true;
      label: string;
      status: ReadinessItemStatus;
      previousStatus: ReadinessItemStatus;
    }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Applies one edit to a readiness requirement — the single action behind
 * "Assign Owner", "Change Due Date", "Upload Evidence", "Mark Complete",
 * "Mark Blocked" and "Mark Not Required", since they all write the same row.
 *
 * The group's readiness score is not touched: it is derived from these rows on
 * every read, so revalidating the group is enough to move the Overview, the
 * category bars and the list badge together.
 */
export async function updateReadinessItemAction(
  input: unknown,
): Promise<UpdateReadinessItemResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageReadiness) {
    return { ok: false, error: "Your role cannot manage the readiness checklist." };
  }

  const parsed = updateReadinessItemSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const outcome = await updateGroupReadinessItem(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/* ── Tasks ────────────────────────────────────────────────────────────────── */

export type CreateGroupTaskResult =
  | { ok: true; taskId: string; title: string }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/** Creates a task against a group ("Create Task"). */
export async function createGroupTaskAction(
  input: unknown,
): Promise<CreateGroupTaskResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageTasks) {
    return { ok: false, error: "Your role cannot manage tasks." };
  }

  const parsed = createGroupTaskSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const ownerId = data.ownerName ? await resolveStaffIdByName(createClient(await cookies()), data.ownerName) : null;
  const outcome = await createGroupTask({ ...data, ownerId });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

export type UpdateGroupTaskStatusResult =
  | { ok: true; title: string; status: TaskStatus }
  | { ok: false; error: string };

/** Moves a task through its lifecycle ("Complete" / reopen). */
export async function updateGroupTaskStatusAction(
  input: unknown,
): Promise<UpdateGroupTaskStatusResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).manageTasks) {
    return { ok: false, error: "Your role cannot manage tasks." };
  }

  const parsed = updateGroupTaskStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That task reference is invalid." };
  }

  const data = parsed.data;
  const outcome = await updateGroupTaskStatus(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${data.departureGroupId}`);
  return { ok: true, ...outcome.result };
}

/* ── Group details & lifecycle ────────────────────────────────────────────── */

export type UpdateGroupDetailsResult =
  | {
      ok: true;
      groupName: string;
      changedFields: string[];
      rescheduledReadinessItems: number;
    }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Edits a group's own details ("Edit Group Details").
 *
 * Capacity is the one field that needs more than `editGroupDetails`: raising or
 * lowering it re-prices what the agency can sell, so it additionally requires
 * `overrideCapacityAndPrice` rather than being silently dropped.
 */
export async function updateGroupDetailsAction(
  input: unknown,
): Promise<UpdateGroupDetailsResult> {
  await requireUser();

  const can = await getCurrentDepartureCapabilities();
  if (!can.editGroupDetails) {
    return { ok: false, error: "Your role cannot edit group details." };
  }

  const parsed = updateGroupDetailsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;

  if (data.capacity !== undefined && !can.overrideCapacityAndPrice) {
    return {
      ok: false,
      error:
        "Your role cannot change the group capacity. Save the other details, or ask an administrator.",
      fieldErrors: { capacity: ["Your role cannot change the capacity."] },
    };
  }

  if (data.pricing !== undefined && !can.overrideCapacityAndPrice) {
    return {
      ok: false,
      error:
        "Your role cannot reprice this departure. Save the other details, or ask an administrator.",
      fieldErrors: { pricing: ["Your role cannot change the price."] },
    };
  }

  if (data.costEstimate !== undefined && !can.overrideCapacityAndPrice) {
    return {
      ok: false,
      error:
        "Your role cannot change this departure's cost estimate. Save the other details, or ask an administrator.",
      fieldErrors: { costEstimate: ["Your role cannot change the cost estimate."] },
    };
  }

  const nusukFieldsTouched =
    data.umrahCompanyName !== undefined ||
    data.nusukProgramRef !== undefined ||
    data.nusukGroupRef !== undefined ||
    data.visaBatchRef !== undefined ||
    data.visaInvoiceRef !== undefined ||
    data.nusukStatus !== undefined;
  if (nusukFieldsTouched && !can.manageDocumentsAndVisa) {
    return {
      ok: false,
      error:
        "Your role cannot change this departure's Nusuk / visa batch details.",
      fieldErrors: {
        nusukStatus: ["Your role cannot change Nusuk / visa batch details."],
      },
    };
  }

  const outcome = await updateGroupDetails(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.groupId}`);
  return { ok: true, ...outcome.result };
}

export type GroupLifecycleResult =
  | {
      ok: true;
      groupName: string;
      groupStatus: DepartureGroupStatus;
      salesStatus: GroupSalesStatus;
      cancelledBookings: number;
      refundPendingAmount: number;
    }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Applies a group-level lifecycle transition: Close/Reopen Sales, Mark Ready to
 * Depart, or Cancel Group.
 *
 * Cancelling is gated harder than the rest — it withdraws every booking on the
 * group and commits the agency to refunding what was collected, so it needs the
 * cancel capability rather than plain edit rights.
 */
export async function setGroupLifecycleAction(
  input: unknown,
): Promise<GroupLifecycleResult> {
  await requireUser();

  const can = await getCurrentDepartureCapabilities();

  const parsed = groupLifecycleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "That group action is not valid.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const data = parsed.data;

  if (data.action === "CANCEL") {
    if (!can.cancelOrArchiveGroup) {
      return { ok: false, error: "Your role cannot cancel departure groups." };
    }
  } else if (!can.editGroupDetails) {
    return { ok: false, error: "Your role cannot change this group's status." };
  }

  const outcome = await setGroupLifecycle(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  if (data.action === "MARK_COMPLETED") {
    // Best-effort review nudge for any Seasonal guide on this group — never
    // lets a logging hiccup roll back a completion that already succeeded.
    try {
      await flagSeasonalGuidesForReview(createClient(await cookies()), data.groupId);
    } catch {
      // Surfacing on the Team page is a convenience, not a correctness
      // requirement — the group is already completed either way.
    }
  }

  revalidatePath("/departure-groups");
  revalidatePath(`/departure-groups/${data.groupId}`);
  return { ok: true, ...outcome.result };
}

/* ── Per-pilgrim customisation ────────────────────────────────────────────── */

export type PilgrimChargeActionResult =
  | { ok: true; charge: PilgrimCharge }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

export type PilgrimDeviationActionResult =
  | { ok: true; deviation: PilgrimDeviation }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/**
 * Replaces one traveller's base fare — the per-pilgrim analogue of repricing
 * a whole booking. Gated the same way `overrideCapacityAndPrice` gates a
 * booking-wide reprice: this touches money directly, not a request for money
 * to be touched.
 */
export async function setPilgrimBaseFareAction(
  input: unknown,
): Promise<PilgrimChargeActionResult> {
  await requireUser();
  if (!(await getCurrentDepartureCapabilities()).overrideCapacityAndPrice) {
    return { ok: false, error: "Your role cannot reprice a traveller." };
  }

  const parsed = setBaseFareSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const outcome = await setPilgrimBaseFare(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true, charge: outcome.charge };
}

export type SetPilgrimRoomTypeActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: DepartureGroupFieldErrors };

/** Sets a traveller's occupancy without touching price — a rooming action, not a finance one. */
export async function setPilgrimRoomTypeAction(
  input: unknown,
): Promise<SetPilgrimRoomTypeActionResult> {
  await requireUser();
  if (!(await getCurrentDepartureCapabilities()).manageRooming) {
    return { ok: false, error: "Your role cannot change room occupancy." };
  }

  const parsed = setPilgrimRoomTypeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const outcome = await setPilgrimRoomType(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true };
}

/**
 * Adds a priced line (add-on, surcharge, discount, correction) to a
 * traveller. A `DISCOUNT` or `PRICE_CORRECTION` always requires approval —
 * enforced again in the data layer, not just here — and a caller without
 * `approveDiscounts` may still raise one, it simply starts unapproved.
 */
export async function addPilgrimChargeAction(
  input: unknown,
): Promise<PilgrimChargeActionResult> {
  await requireUser();
  if (!(await getCurrentDepartureCapabilities()).manageTravellerCustomisations) {
    return { ok: false, error: "Your role cannot add traveller charges." };
  }

  const parsed = addChargeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const outcome = await addPilgrimCharge(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true, charge: outcome.charge };
}

/** Voids a charge line — never deletes it. */
export async function voidPilgrimChargeAction(
  input: unknown,
): Promise<PilgrimChargeActionResult> {
  await requireUser();
  if (!(await getCurrentDepartureCapabilities()).manageTravellerCustomisations) {
    return { ok: false, error: "Your role cannot remove traveller charges." };
  }

  const parsed = voidChargeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "A reason is required to void a charge.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const outcome = await voidPilgrimCharge(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true, charge: outcome.charge };
}

/** Signs off a charge that was flagged as needing approval. */
export async function approvePilgrimChargeAction(
  input: unknown,
): Promise<PilgrimChargeActionResult> {
  await requireUser();
  if (!(await getCurrentDepartureCapabilities()).approveDiscounts) {
    return { ok: false, error: "Your role cannot approve this charge." };
  }

  const parsed = approveChargeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That charge reference is invalid." };
  }

  const outcome = await approvePilgrimCharge(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true, charge: outcome.charge };
}

/** Raises an operational deviation on a traveller (extra nights, own flight, an add-on…). */
export async function requestPilgrimDeviationAction(
  input: unknown,
): Promise<PilgrimDeviationActionResult> {
  await requireUser();
  if (!(await getCurrentDepartureCapabilities()).manageTravellerCustomisations) {
    return { ok: false, error: "Your role cannot request traveller customisations." };
  }

  const parsed = requestDeviationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const outcome = await requestPilgrimDeviation(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true, deviation: outcome.deviation };
}

/** Approves or declines a requested deviation. */
export async function decidePilgrimDeviationAction(
  input: unknown,
): Promise<PilgrimDeviationActionResult> {
  await requireUser();
  const can = await getCurrentDepartureCapabilities();
  if (!can.manageTravellerCustomisations && !can.approveDiscounts) {
    return { ok: false, error: "Your role cannot decide on traveller customisations." };
  }

  const parsed = decideDeviationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "A decline needs a reason.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const outcome = await decidePilgrimDeviation(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true, deviation: outcome.deviation };
}

/** Marks an approved deviation as actually arranged. */
export async function markDeviationArrangedAction(
  input: unknown,
): Promise<PilgrimDeviationActionResult> {
  await requireUser();
  if (!(await getCurrentDepartureCapabilities()).manageTravellerCustomisations) {
    return { ok: false, error: "Your role cannot arrange traveller customisations." };
  }

  const parsed = markDeviationArrangedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That deviation reference is invalid." };
  }

  const outcome = await markPilgrimDeviationArranged(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true, deviation: outcome.deviation };
}

/** Cancels a deviation that has not yet been arranged. */
export async function cancelPilgrimDeviationAction(
  input: unknown,
): Promise<PilgrimDeviationActionResult> {
  await requireUser();
  if (!(await getCurrentDepartureCapabilities()).manageTravellerCustomisations) {
    return { ok: false, error: "Your role cannot cancel traveller customisations." };
  }

  const parsed = cancelDeviationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "A reason is required to cancel a deviation.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const outcome = await cancelPilgrimDeviation(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true, deviation: outcome.deviation };
}

/** Creates a deviation + optional paired charge in one submission. */
export async function requestPilgrimCustomisationAction(
  input: unknown,
): Promise<PilgrimDeviationActionResult> {
  await requireUser();
  if (!(await getCurrentDepartureCapabilities()).manageTravellerCustomisations) {
    return { ok: false, error: "Your role cannot request traveller customisations." };
  }

  const parsed = requestDeviationWithChargeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  const outcome = await requestPilgrimCustomisation(parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true, deviation: outcome.deviation };
}

/** Letterhead facts for a customer-facing invoice PDF — read-only, not gated by finance capabilities. */
export interface InvoiceLetterhead {
  agencyName: string;
  legalName: string | null;
  registrationNumber: string | null;
  officeAddress: string | null;
  primaryEmail: string | null;
  invoiceFooter: string;
  /** Short-lived; the caller must not cache this beyond the current page load. */
  logoUrl: string | null;
}

export type EraseTravellerDataResult =
  | { ok: true; filesRemoved: number; personRecordErased: boolean }
  | { ok: false; error: string };

/**
 * Erases one traveller's passport, contact and file details at a person's request ("Erase Sensitive
 * Details"). Admin only and irreversible; the traveller's name and every booking, payment and invoice
 * record stay. Refused while the traveller's trip has not finished.
 */
export async function eraseTravellerDataAction(input: unknown): Promise<EraseTravellerDataResult> {
  await requireUser();

  if (!(await getCurrentDepartureCapabilities()).eraseTravellerData) {
    return { ok: false, error: "Your role cannot erase traveller details." };
  }

  const parsed = eraseTravellerDataSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That request is invalid." };
  }

  const outcome = await eraseTravellerSensitiveData({
    departureGroupId: parsed.data.departureGroupId,
    pilgrimId: parsed.data.pilgrimId,
    reason: "REQUEST",
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
  return { ok: true, filesRemoved: outcome.filesRemoved, personRecordErased: outcome.personRecordErased };
}

export async function getInvoiceLetterheadAction(): Promise<InvoiceLetterhead> {
  await requireUser();
  const supabase = createClient(await cookies());
  const settings = await getAgencySettings(supabase);
  const logoUrl = settings.logo_path ? await agencyAssetSignedUrl(settings.logo_path) : null;

  return {
    agencyName: settings.agency_name,
    legalName: settings.legal_name,
    registrationNumber: settings.registration_number,
    officeAddress: settings.office_address,
    primaryEmail: settings.primary_email,
    invoiceFooter: settings.invoice_footer,
    logoUrl,
  };
}

/* ── Activity — load more ─────────────────────────────────────────────────── */

export type LoadMoreActivityResult =
  | { ok: true; activity: GroupActivityLog[] }
  | { ok: false; error: string };

/**
 * The next page of a group's activity trail, older than `before`. Backs the
 * Activity tab's "load more" — `getDepartureGroupDetail()` only ever
 * hydrates the newest 200 rows, so a long-running group's earlier history
 * was previously unreachable from the UI at all.
 */
export async function loadMoreGroupActivityAction(input: {
  departureGroupId: string;
  before: string;
}): Promise<LoadMoreActivityResult> {
  await requireUser();

  const { role } = await getCurrentStaffRole();
  // Matches `visibleTabsFor()` (lib/access/departure-groups-access.ts): the
  // Activity tab itself is hidden for these two roles, so this action must
  // refuse them too rather than trust that the UI never calls it.
  if (role === "MARKETING" || role === "GUIDE") {
    return { ok: false, error: "Your role cannot view this group's activity trail." };
  }

  if (!input.departureGroupId || !input.before) {
    return { ok: false, error: "Invalid request." };
  }

  const activity = await loadMoreGroupActivity(input.departureGroupId, input.before, role);
  return { ok: true, activity };
}
