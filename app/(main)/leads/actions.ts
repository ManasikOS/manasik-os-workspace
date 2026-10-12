"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { createGroupBooking } from "@/lib/data/departure-groups";
import { describeLeadFailure } from "@/lib/data/lead-errors";
import { allocateReferences } from "@/lib/data/lead-references";
import { getLeadActor } from "@/lib/data/leads-actor";
import {
  addLeadNoteInStore,
  assignLeadInStore,
  changeLeadStageInStore,
  completeFollowUpInStore,
  createLeadInStore,
  normaliseMobile,
  logContactInStore,
  markLeadBookedInStore,
  recordQuoteInStore,
  selectDepartureGroupInStore,
  setFollowUpInStore,
  updateQuoteStatusInStore,
  type CreateLeadInput,
  type MutationOutcome,
} from "@/lib/data/leads";
import {
  isLeadDuplicateResolved,
  LEAD_DUPLICATE_BLOCKED_MESSAGE,
} from "@/lib/data/lead-duplicate-gate";
import {
  changeOneLead,
  findDuplicateLeadSummary,
  findExistingLeadMobiles,
  loadAssignableStaff,
  loadLeadStore,
  persistLeadStore,
  snapshotLeadStore,
  type DuplicateLeadSummary,
  type LeadStore,
} from "@/lib/data/leads-repository";
import { requireUser } from "@/lib/dal";
import type { LeadQuotePricingSnapshot, LeadRoomPreference } from "@/lib/types/leads";
import {
  addNoteActionSchema,
  assignLeadsActionSchema,
  changeStageActionSchema,
  completeFollowUpActionSchema,
  convertToBookingActionSchema,
  createLeadSchema,
  findAvailableGroupsActionSchema,
  IMPORTABLE_STAGES,
  importLeadsActionSchema,
  leadSourceActionSchema,
  logContactActionSchema,
  selectDepartureGroupActionSchema,
  setFollowUpActionSchema,
  toLeadFieldErrors,
  updateConsentActionSchema,
  updateQuoteStatusActionSchema,
  type CreateLeadFormInput,
} from "@/lib/validations/leads";
import { createClient } from "@/utils/supabase/server";
import type { FollowUpType, LeadLostReason, LeadStage } from "@/lib/types/leads";
import type { QuoteStatus } from "@/lib/copilot/sales/types";
import type { ConsentChannel, ConsentStatus } from "@/lib/types/consent";

async function db() {
  return createClient(await cookies());
}

/**
 * Runs `work`, turning anything it throws into a fixed, safe sentence (and a server log line with a reference) instead of a raw database error.
 * Next's own control-flow errors (redirect, notFound) carry a `digest` and must keep propagating.
 */
async function guarded<T>(context: string, work: () => Promise<T>, failed: (message: string) => T): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    const digest = cause && typeof cause === "object" && "digest" in cause ? String((cause as { digest: unknown }).digest) : "";
    if (digest.startsWith("NEXT_")) throw cause;
    return failed(describeLeadFailure(cause, context).message);
  }
}

function revalidateLeads() {
  revalidatePath("/leads");
  revalidatePath("/quotes");
}

const INVALID_REQUEST = "That request was not valid. Refresh the page and try again.";

/* ── Create ───────────────────────────────────────────────────────────────── */

export interface CreateLeadActionResult extends MutationOutcome {
  reference?: string;
  /** The new lead's id, so the screen can open it on the Leads page. */
  leadId?: string;
  fieldErrors?: Partial<Record<keyof CreateLeadFormInput, string>>;
}

export async function createLeadAction(
  input: unknown,
): Promise<CreateLeadActionResult> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.createLead) {
    return { ok: false, error: "Your role cannot create leads." };
  }

  const parsed = createLeadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toLeadFieldErrors(parsed.error),
    };
  }
  const data = parsed.data;

  return guarded<CreateLeadActionResult>(
    "createLead",
    async () => {
      const supabase = await db();

      // The server is the real gate for duplicates: the form's warning is a
      // convenience and can be skipped by calling the action directly.
      const duplicate = await findDuplicateLeadSummary(
        supabase,
        normaliseMobile(data.mobile),
        data.email,
      );
      if (!isLeadDuplicateResolved(duplicate !== null, data)) {
        return {
          ok: false,
          error: LEAD_DUPLICATE_BLOCKED_MESSAGE,
          fieldErrors: { duplicateReason: LEAD_DUPLICATE_BLOCKED_MESSAGE },
        };
      }

      // Owners are looked up, never taken from the form: an unknown id must not become a lead's owner under whatever name came with it.
      const staffOptions = await loadAssignableStaff(supabase);
      const owner = staffOptions.find((s) => s.id === data.assignedToId);
      if (!owner) {
        return {
          ok: false,
          error: "Choose an active sales owner.",
          fieldErrors: { assignedToId: "Choose an active sales owner." },
        };
      }
      const followUpOwner = data.followUpOwnerId
        ? staffOptions.find((s) => s.id === data.followUpOwnerId)
        : owner;
      if (!followUpOwner) {
        return {
          ok: false,
          error: "Choose an active follow-up owner.",
          fieldErrors: { followUpOwnerId: "Choose an active follow-up owner." },
        };
      }

      // Only the packages are needed (to price the lead); the reference comes from the database counter, not from the leads already read.
      const store = await loadLeadStore(supabase, { only: ["packages"] });
      const [reference] = await allocateReferences(supabase, "LEAD", 1);
      const before = snapshotLeadStore(store);

      const createInput: CreateLeadInput = {
        fullName: data.fullName,
        mobile: data.mobile,
        email: data.email,
        city: data.city,
        preferredLanguage: data.preferredLanguage,
        preferredChannel: data.preferredChannel,
        journeyType: data.journeyType,
        interestedIn: data.interestedIn,
        packageId: data.packageId,
        preferredPeriod: data.preferredPeriod,
        adults: data.adults,
        children: data.children,
        roomPreference: data.roomPreference,
        departureCity: data.departureCity,
        budgetRange: data.budgetRange,
        quotaWaitlistInterest: data.quotaWaitlistInterest,
        source: data.source,
        campaignReference: data.campaignReference,
        referralName: data.referralName,
        assignedToId: owner.id,
        assignedToName: owner.name,
        stage: data.stage,
        temperature: data.temperature,
        nextFollowUpAt: data.nextFollowUpAt,
        followUpType: data.followUpType,
        followUpOwnerId: followUpOwner.id,
        followUpOwnerName: followUpOwner.name,
        notes: data.notes,
        duplicateOverrideReason: data.createAnyway ? data.duplicateReason : undefined,
      };

      const outcome = createLeadInStore(store, createInput, new Date().toISOString(), { reference });
      if (!outcome.ok) return outcome;

      await persistLeadStore(supabase, before, store);
      revalidateLeads();
      return { ok: true, reference: outcome.lead?.reference, leadId: outcome.lead?.id };
    },
    (error) => ({ ok: false, error }),
  );
}

/**
 * Bulk create for the CSV import dialog. Best-effort — one bad row does not stop the rest.
 *
 * The browser's parsed rows are only a request: every row is re-validated here, its owner is resolved against the agency's active staff, a stage
 * beyond the early pipeline is reset to New Lead, and mobiles already on file are skipped by asking the database (not the page's copy).
 */
export async function importLeadsAction(
  rows: CreateLeadInput[],
): Promise<{ ok: true; created: number; failures: string[] }> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.createLead) {
    return { ok: true, created: 0, failures: ["Your role cannot import leads."] };
  }

  const parsed = importLeadsActionSchema.safeParse(rows);
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some((issue) => issue.code === "too_big" && issue.path.length === 0);
    return {
      ok: true,
      created: 0,
      failures: [tooMany ? "Import at most 500 leads at a time." : "The import file has rows that are not valid. Check the file and try again."],
    };
  }

  return guarded<{ ok: true; created: number; failures: string[] }>(
    "importLeads",
    async () => {
      const supabase = await db();
      const staffOptions = await loadAssignableStaff(supabase);
      const staffById = new Map(staffOptions.map((staff) => [staff.id, staff]));
      const existing = await findExistingLeadMobiles(supabase, parsed.data.map((row) => normaliseMobile(row.mobile)));

      const failures: string[] = [];
      const accepted: CreateLeadInput[] = [];
      const seenInFile = new Set<string>();

      for (const row of parsed.data) {
        const mobile = normaliseMobile(row.mobile);
        const owner = staffById.get(row.assignedToId);
        const followUpOwner = staffById.get(row.followUpOwnerId) ?? owner;

        if (!owner || !followUpOwner) {
          failures.push(`${row.fullName}: the assigned owner is not an active sales owner.`);
          continue;
        }
        const onFile = existing.get(mobile);
        if (onFile) {
          failures.push(`${row.fullName}: already exists as ${onFile}.`);
          continue;
        }
        if (seenInFile.has(mobile)) {
          failures.push(`${row.fullName}: the same mobile appears earlier in this file.`);
          continue;
        }
        seenInFile.add(mobile);

        accepted.push({
          ...row,
          stage: (IMPORTABLE_STAGES as readonly string[]).includes(row.stage) ? row.stage : "NEW_LEAD",
          assignedToName: owner.name,
          followUpOwnerName: followUpOwner.name,
        });
      }

      if (accepted.length === 0) return { ok: true, created: 0, failures };

      const store = await loadLeadStore(supabase, { only: ["packages"] });
      const before = snapshotLeadStore(store);
      const references = await allocateReferences(supabase, "LEAD", accepted.length);
      const now = new Date().toISOString();

      let created = 0;
      accepted.forEach((row, index) => {
        const outcome = createLeadInStore(store, row, now, { reference: references[index] });
        if (outcome.ok) created += 1;
        else failures.push(`${row.fullName}: ${outcome.error}`);
      });

      if (created > 0) {
        await persistLeadStore(supabase, before, store);
        revalidateLeads();
      }
      return { ok: true, created, failures };
    },
    (error) => ({ ok: true, created: 0, failures: [error] }),
  );
}

/* ── Duplicate check ──────────────────────────────────────────────────────── */

export type CheckLeadDuplicateResult =
  | { ok: true; duplicate: { lead: DuplicateLeadSummary; matchedOn: "mobile" | "email" } | null }
  | { ok: false; error: string };

const checkLeadDuplicateSchema = z.object({
  mobile: z.string().max(40),
  email: z.string().max(320),
});

/**
 * Looks for an existing lead with this mobile or email, for the Add Lead
 * screen's warning. Reads two narrow rows rather than the whole store, and only
 * for roles that may create leads (the answer reveals another lead's details).
 */
export async function checkLeadDuplicateAction(
  input: unknown,
): Promise<CheckLeadDuplicateResult> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.createLead) {
    return { ok: false, error: "Your role cannot create leads." };
  }

  const parsed = checkLeadDuplicateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter a mobile number or email to check." };
  }

  return guarded<CheckLeadDuplicateResult>(
    "checkLeadDuplicate",
    async () => {
      const duplicate = await findDuplicateLeadSummary(
        await db(),
        normaliseMobile(parsed.data.mobile),
        parsed.data.email,
      );
      return { ok: true, duplicate };
    },
    (error) => ({ ok: false, error }),
  );
}

/* ── Stage / assignment ───────────────────────────────────────────────────── */

export interface BulkOutcome extends MutationOutcome {
  changed: number;
}

export async function changeStageAction(input: {
  leadIds: string[];
  stage: LeadStage;
  lostReason?: LeadLostReason;
  lostNote?: string;
  postponedUntil?: string | null;
}): Promise<BulkOutcome> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.changeStage) {
    return { ok: false, error: "Your role cannot change a lead's stage.", changed: 0 };
  }
  const parsed = changeStageActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_REQUEST, changed: 0 };
  const request = parsed.data;

  return guarded<BulkOutcome>(
    "changeStage",
    async () => {
      const supabase = await db();
      let changed = 0;
      let error: string | undefined;

      // One lead at a time, each version-checked: a colleague's change to lead B must not make the whole selection fail or overwrite it.
      for (const leadId of request.leadIds) {
        try {
          const outcome = await changeOneLead(
            supabase,
            leadId,
            (store) =>
              changeLeadStageInStore(
                store,
                {
                  leadId,
                  stage: request.stage,
                  actorName: who.name,
                  lostReason: request.lostReason,
                  lostNote: request.lostNote,
                  postponedUntil: request.postponedUntil,
                },
                new Date().toISOString(),
              ),
            // The quotes decide whether Deposit Pending is allowed.
            { collections: ["quotes"] },
          );
          if (outcome.ok) changed += 1;
          else error ??= outcome.error;
        } catch (cause) {
          error ??= describeLeadFailure(cause, "changeStage").message;
        }
      }

      if (changed > 0) revalidateLeads();
      return { ok: changed > 0, error: changed > 0 ? undefined : error, changed };
    },
    (message) => ({ ok: false, error: message, changed: 0 }),
  );
}

export async function assignLeadsAction(input: {
  leadIds: string[];
  staffId: string;
}): Promise<BulkOutcome> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.assignLeads) {
    return { ok: false, error: "Your role cannot reassign leads.", changed: 0 };
  }
  const parsed = assignLeadsActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_REQUEST, changed: 0 };
  const request = parsed.data;

  return guarded<BulkOutcome>(
    "assignLeads",
    async () => {
      const supabase = await db();
      const staff = (await loadAssignableStaff(supabase)).find((s) => s.id === request.staffId);
      if (!staff) return { ok: false, error: "Unknown staff member.", changed: 0 };

      let changed = 0;
      let error: string | undefined;
      for (const leadId of request.leadIds) {
        try {
          const outcome = await changeOneLead(supabase, leadId, (store) =>
            assignLeadInStore(
              store,
              { leadId, staffId: staff.id, staffName: staff.name, actorName: who.name },
              new Date().toISOString(),
            ),
          );
          if (outcome.ok) changed += 1;
          else error ??= outcome.error;
        } catch (cause) {
          error ??= describeLeadFailure(cause, "assignLeads").message;
        }
      }

      if (changed > 0) revalidateLeads();
      return { ok: changed > 0, error: changed > 0 ? undefined : error, changed };
    },
    (message) => ({ ok: false, error: message, changed: 0 }),
  );
}

/* ── Contact / follow-up / notes ─────────────────────────────────────────── */

/** Runs one single-lead mutator under a version check, then refreshes the pages that show it. */
async function changeLead(
  context: string,
  leadId: string,
  mutate: (store: LeadStore) => MutationOutcome,
  options?: { collections?: readonly (keyof LeadStore)[]; attempts?: number },
): Promise<MutationOutcome> {
  return guarded<MutationOutcome>(
    context,
    async () => {
      const outcome = await changeOneLead(await db(), leadId, mutate, options);
      if (outcome.ok) revalidateLeads();
      return outcome;
    },
    (error) => ({ ok: false, error }),
  );
}

export async function logContactAction(input: {
  leadId: string;
  summary: string;
  nextFollowUpAt: string | null;
  followUpType: FollowUpType | null;
  followUpOwnerId?: string;
  advanceToStage?: LeadStage;
}): Promise<MutationOutcome> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.logContact) {
    return { ok: false, error: "Your role cannot log contact." };
  }
  const parsed = logContactActionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_REQUEST };
  }
  const request = parsed.data;

  // The follow-up owner is looked up, not trusted: the id must be an active owner and the name written is theirs.
  let owner: { id: string; name: string } | undefined;
  if (request.nextFollowUpAt && request.followUpOwnerId) {
    owner = (await guarded("logContact.staff", async () => loadAssignableStaff(await db()), () => []))
      .find((staff) => staff.id === request.followUpOwnerId);
    if (!owner) return { ok: false, error: "Choose an active follow-up owner." };
  }

  return changeLead("logContact", request.leadId, (store) =>
    logContactInStore(
      store,
      {
        leadId: request.leadId,
        summary: request.summary,
        actorName: who.name,
        nextFollowUpAt: request.nextFollowUpAt,
        followUpType: request.followUpType,
        followUpOwnerId: owner?.id,
        followUpOwnerName: owner?.name,
        advanceToStage: request.advanceToStage,
      },
      new Date().toISOString(),
    ),
  );
}

export async function setFollowUpAction(input: {
  leadId: string;
  nextFollowUpAt: string;
  followUpType: FollowUpType;
  followUpOwnerId: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.logContact) {
    return { ok: false, error: "Your role cannot schedule follow-ups." };
  }
  const parsed = setFollowUpActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_REQUEST };
  const request = parsed.data;

  const staff = await guarded("setFollowUp.staff", async () => loadAssignableStaff(await db()), () => []);
  const owner = staff.find((s) => s.id === request.followUpOwnerId);
  if (!owner) return { ok: false, error: "Choose an active follow-up owner." };

  return changeLead("setFollowUp", request.leadId, (store) =>
    setFollowUpInStore(
      store,
      {
        leadId: request.leadId,
        nextFollowUpAt: request.nextFollowUpAt,
        followUpType: request.followUpType,
        followUpOwnerId: owner.id,
        followUpOwnerName: owner.name,
        actorName: who.name,
      },
      new Date().toISOString(),
    ),
  );
}

export async function completeFollowUpAction(leadId: string): Promise<MutationOutcome> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.logContact) {
    return { ok: false, error: "Your role cannot complete follow-ups." };
  }
  const parsed = completeFollowUpActionSchema.safeParse({ leadId });
  if (!parsed.success) return { ok: false, error: INVALID_REQUEST };

  return changeLead("completeFollowUp", parsed.data.leadId, (store) =>
    completeFollowUpInStore(store, { leadId: parsed.data.leadId, actorName: who.name }, new Date().toISOString()),
  );
}

export async function addNoteAction(input: { leadId: string; note: string }): Promise<MutationOutcome> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.addNote) {
    return { ok: false, error: "Your role cannot add notes." };
  }
  const parsed = addNoteActionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_REQUEST };
  }

  return changeLead("addNote", parsed.data.leadId, (store) =>
    addLeadNoteInStore(store, { leadId: parsed.data.leadId, note: parsed.data.note, actorName: who.name }, new Date().toISOString()),
  );
}

/* ── Group selection ──────────────────────────────────────────────────────── */

/** Groups a lead can show interest in: not archived and not closed out. Mirrors the picker (`findAvailableGroupsAction`) without its seat filter. */
const CLOSED_GROUP_STATUSES = ["CANCELLED", "COMPLETED", "CLOSED"];

export async function selectDepartureGroupAction(input: {
  leadId: string;
  departureGroupId: string;
  /** Ignored. The label is read from the group itself. */
  groupLabel?: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.findGroups) {
    return { ok: false, error: "Your role cannot select departure groups." };
  }
  const parsed = selectDepartureGroupActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_REQUEST };
  const request = parsed.data;

  return guarded<MutationOutcome>(
    "selectDepartureGroup",
    async () => {
      const supabase = await db();
      const { data: group, error } = await supabase
        .from("departure_groups")
        .select("group_name, group_code, group_status, archived")
        .eq("id", request.departureGroupId)
        .maybeSingle();
      if (error) throw error;
      if (!group || group.archived || CLOSED_GROUP_STATUSES.includes(String(group.group_status))) {
        return { ok: false, error: "That departure group is no longer available." };
      }

      const groupLabel = `${group.group_name} (${group.group_code})`;
      const outcome = await changeOneLead(supabase, request.leadId, (store) =>
        selectDepartureGroupInStore(
          store,
          { leadId: request.leadId, departureGroupId: request.departureGroupId, groupLabel, actorName: who.name },
          new Date().toISOString(),
        ),
      );
      if (outcome.ok) revalidateLeads();
      return outcome;
    },
    (error) => ({ ok: false, error }),
  );
}

/* ── Departure group recommendation (Phase 4) ────────────────────────────── */

export interface AvailableGroupOption {
  id: string;
  groupName: string;
  groupCode: string;
  departureDate: string;
  returnDate: string;
  availableSeats: number;
  salesStatus: string;
  currency: string;
  quadPrice: number | null;
  triplePrice: number | null;
  doublePrice: number | null;
  singlePrice: number | null;
  advanceDeposit: number | null;
}

/**
 * Only sellable groups: `SELLING`/`LIMITED_AVAILABILITY`, enough seats left,
 * not cancelled/completed/closed, matching the lead's journey type. Never
 * touches capacity — this is a read, not a hold.
 */
export async function findAvailableGroupsAction(input: {
  journeyType: string;
  packageId: string | null;
  requiredSeats: number;
}): Promise<AvailableGroupOption[]> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.findGroups) return [];
  const parsed = findAvailableGroupsActionSchema.safeParse(input);
  if (!parsed.success) return [];
  const request = parsed.data;

  const supabase = await db();
  // Prices come from `departure_group_pricing` — the group's CURRENT,
  // editable price — never from `departure_group_package_snapshots
  // .pricing_snapshot`, which is a placeholder frozen at creation time and
  // never updated after (`emptyPricingSnapshot()` in
  // lib/data/departure-groups-copy.ts always seeds it null; the group's
  // real price has lived in `departure_group_pricing` since
  // `20260908090000_departure_group_pricing.sql`). Reading the snapshot
  // here meant every quoted price in this picker was null regardless of
  // what the group actually sells at. See
  // docs/modules/packages-production-readiness-plan.md, finding D1.
  let query = supabase
    .from("departure_groups")
    .select(
      "id, group_name, group_code, journey_type, departure_date, return_date, available_seats, sales_status, group_status, archived, package_template_id, departure_group_pricing(currency, quad_price, triple_price, double_price, single_price, advance_deposit)",
    )
    .in("sales_status", ["SELLING", "LIMITED_AVAILABILITY"])
    .not("group_status", "in", "(CANCELLED,COMPLETED,CLOSED)")
    .eq("archived", false)
    .eq("journey_type", request.journeyType)
    .gte("available_seats", request.requiredSeats)
    .order("departure_date", { ascending: true });

  if (request.packageId) query = query.eq("package_template_id", request.packageId);

  const { data, error } = await query;
  if (error) return [];

  return (data ?? []).map((row: Record<string, unknown>) => {
    const pricing = (
      Array.isArray(row.departure_group_pricing)
        ? row.departure_group_pricing[0]
        : row.departure_group_pricing
    ) as Record<string, unknown> | null ?? {};

    return {
      id: String(row.id),
      groupName: String(row.group_name),
      groupCode: String(row.group_code),
      departureDate: String(row.departure_date),
      returnDate: String(row.return_date),
      availableSeats: Number(row.available_seats),
      salesStatus: String(row.sales_status),
      currency: String(pricing.currency ?? "LKR"),
      quadPrice: pricing.quad_price === undefined || pricing.quad_price === null ? null : Number(pricing.quad_price),
      triplePrice: pricing.triple_price === undefined || pricing.triple_price === null ? null : Number(pricing.triple_price),
      doublePrice: pricing.double_price === undefined || pricing.double_price === null ? null : Number(pricing.double_price),
      singlePrice: pricing.single_price === undefined || pricing.single_price === null ? null : Number(pricing.single_price),
      advanceDeposit: pricing.advance_deposit === undefined || pricing.advance_deposit === null ? null : Number(pricing.advance_deposit),
    };
  });
}

/* ── Quotes (Phase 5) ─────────────────────────────────────────────────────── */

export interface SendQuoteInput {
  leadId: string;
  packageId: string | null;
  departureGroupId: string | null;
  roomPreference: LeadRoomPreference;
  adults: number;
  children: number;
  roomPricePerPerson: number;
  depositPerPerson: number;
  currency: string;
  packageName: string;
  groupLabel: string | null;
  groupDates: string | null;
  sentVia: "WHATSAPP" | "EMAIL" | "PDF" | null;
}

export interface SendQuoteResult extends MutationOutcome {
  reference?: string;
  totalLkr?: number;
  depositLkr?: number;
  validUntil?: string;
}

const sendQuoteInputSchema = z.object({
  leadId: z.uuid(),
  packageId: z.uuid().nullable(),
  departureGroupId: z.uuid().nullable(),
  roomPreference: z.enum(["QUAD", "TRIPLE", "DOUBLE", "SINGLE", "UNDECIDED"]),
  adults: z.number().int().min(1).max(60),
  children: z.number().int().min(0).max(60),
  roomPricePerPerson: z.number().positive().max(100_000_000),
  depositPerPerson: z.number().min(0).max(100_000_000),
  currency: z.string().trim().min(1).max(8),
  packageName: z.string().trim().max(200),
  groupLabel: z.string().trim().max(200).nullable(),
  groupDates: z.string().trim().max(100).nullable(),
  sentVia: z.enum(["WHATSAPP", "EMAIL", "PDF"]).nullable(),
});

export async function sendQuoteAction(input: SendQuoteInput): Promise<SendQuoteResult> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.sendQuote) {
    return { ok: false, error: "Your role cannot send quotes." };
  }
  const parsed = sendQuoteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_REQUEST };
  const request = parsed.data;

  const travellers = request.adults + request.children;
  const totalLkr = request.roomPricePerPerson * travellers;
  const depositLkr = request.depositPerPerson * travellers;
  const now = new Date().toISOString();
  const validUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();

  const pricingSnapshot: LeadQuotePricingSnapshot = {
    currency: request.currency,
    roomPricePerPerson: request.roomPricePerPerson,
    depositPerPerson: request.depositPerPerson,
    paymentMilestones: [],
    packageName: request.packageName,
    groupLabel: request.groupLabel,
    groupDates: request.groupDates,
  };

  return guarded<SendQuoteResult>(
    "sendQuote",
    async () => {
      const supabase = await db();
      // Allocated once, before the version-checked write, so a retry after a conflict reuses the same number.
      const [reference] = await allocateReferences(supabase, "QUOTE", 1);

      const result = await changeOneLead(supabase, request.leadId, (store) =>
        recordQuoteInStore(
          store,
          {
            leadId: request.leadId,
            actorName: who.name,
            quote: {
              reference,
              package_id: request.packageId,
              departure_group_id: request.departureGroupId,
              pricing_snapshot: pricingSnapshot,
              adults: request.adults,
              children: request.children,
              room_preference: request.roomPreference,
              total_lkr: totalLkr,
              deposit_lkr: depositLkr,
              valid_until: validUntil,
              sent_via: request.sentVia,
              sent_at: request.sentVia ? now : null,
              created_by_name: who.name,
              status: "SENT",
              occupancy_type: request.roomPreference === "UNDECIDED" ? null : request.roomPreference,
              infants: 0,
              price_per_person: request.roomPricePerPerson,
              discount_amount: 0,
              discount_reason: null,
              payment_milestones: [],
              inclusions: [],
              exclusions: [],
              created_by_user_id: null,
              supersedes_quote_id: null,
              viewed_at: null,
              cancelled_at: null,
              rejection_reason: null,
              owner_id: null,
              discount_approved_by: null,
              discount_approved_at: null,
              booking_id: null,
              portal_token_hash: null,
            },
          },
          now,
        ),
      );

      if (!result.ok) return result;
      revalidateLeads();
      return { ok: true, reference, totalLkr, depositLkr, validUntil };
    },
    (error) => ({ ok: false, error }),
  );
}

/**
 * Records the customer's decision on a sent quote (accept/decline) or an
 * explicit expiry/cancellation. Gated by the same capability as sending one
 * — accepting here only marks the offer's state; converting it into a
 * booking is still a separate, deliberate action
 * (`convertLeadToBookingAction`).
 */
export async function updateQuoteStatusAction(input: {
  quoteId: string;
  status: QuoteStatus;
}): Promise<MutationOutcome> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.sendQuote) {
    return { ok: false, error: "Your role cannot change a quote's status." };
  }
  const parsed = updateQuoteStatusActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_REQUEST };
  const request = parsed.data;

  return guarded<MutationOutcome>(
    "updateQuoteStatus",
    async () => {
      const supabase = await db();
      const { data: quote, error } = await supabase.from("lead_quotes").select("lead_id").eq("id", request.quoteId).maybeSingle();
      if (error) throw error;
      if (!quote) return { ok: false, error: "That quote no longer exists." };

      const outcome = await changeOneLead(
        supabase,
        String(quote.lead_id),
        (store) =>
          updateQuoteStatusInStore(
            store,
            { quoteId: request.quoteId, status: request.status, actorName: who.name },
            new Date().toISOString(),
          ),
        { collections: ["quotes"] },
      );
      if (outcome.ok) revalidateLeads();
      return outcome;
    },
    (error) => ({ ok: false, error }),
  );
}

/* ── Consent ──────────────────────────────────────────────────────────────── */

/**
 * Records an explicit consent/do-not-contact decision on a lead. Gated by
 * `editLead` — the same capability that already lets a role change any
 * other lead field.
 *
 * The change, its `consent_events` audit row and its timeline entry are written by one database function (`set_lead_consent`) in one transaction:
 * previously the audit insert ran afterwards and its failure was logged and ignored, leaving a consent change with no record. The actor's name is
 * read from the session inside that function. Lifting do-not-contact is checked there as well as here.
 */
export async function updateLeadConsentAction(input: {
  leadId: string;
  consentStatus: ConsentStatus;
  doNotContact: boolean;
  contactableChannels: ConsentChannel[];
  source: string;
  note?: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.editLead) {
    return { ok: false, error: "Your role cannot record consent decisions." };
  }
  const parsed = updateConsentActionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_REQUEST };
  }
  const request = parsed.data;

  return guarded<MutationOutcome>(
    "updateLeadConsent",
    async () => {
      const supabase = await db();

      if (!request.doNotContact && !who.can.clearDoNotContact) {
        const { data: current, error: readError } = await supabase
          .from("leads")
          .select("do_not_contact")
          .eq("id", request.leadId)
          .maybeSingle();
        if (readError) throw readError;
        if (!current) return { ok: false, error: "That lead no longer exists." };
        if (current.do_not_contact) {
          return { ok: false, error: "Only an administrator can clear do-not-contact." };
        }
      }

      const { error } = await supabase.rpc("set_lead_consent", {
        p_lead_id: request.leadId,
        p_status: request.consentStatus,
        p_dnc: request.doNotContact,
        p_channels: request.contactableChannels,
        p_source: request.source,
        p_note: request.note ?? null,
      });
      if (error) throw error;

      revalidateLeads();
      return { ok: true };
    },
    (message) => ({ ok: false, error: message }),
  );
}

/* ── Convert to booking (Phase 6) ────────────────────────────────────────── */

export interface ConvertToBookingInput {
  leadId: string;
  departureGroupId: string;
  primaryContactName: string;
  primaryContactPhone: string;
  adults: number;
  children: number;
  roomOccupancyPreference: "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE" | "OTHER";
  packagePricePerPerson: number;
  depositAmount: number;
}

export interface ConvertToBookingResult extends MutationOutcome {
  bookingReference?: string;
}

/** A conversion claim older than this is treated as abandoned (the request that took it died) and may be taken again. */
const CONVERSION_CLAIM_TTL_MS = 3 * 60_000;

/** Stages a lead cannot be converted from: the person is not an active prospect. */
const NOT_CONVERTIBLE_STAGES: LeadStage[] = ["LOST", "SPAM", "DUPLICATE"];

/**
 * Runs the spec's ten conversion steps. Seat holding, pilgrim placeholders and
 * document/payment-milestone copying are already implemented and tested in
 * `createGroupBooking` (`lib/data/departure-groups.ts`) — this delegates to it
 * rather than re-deriving that logic, then links the result back onto the lead.
 *
 * Two steps cannot share a transaction (the booking is written by the Departure Groups module), so the action is built to be safe to repeat:
 *   1. the lead is CLAIMED with a compare-and-swap on `converting_at`, so two clicks or two people cannot both create a booking;
 *   2. a booking already linked to this lead (`departure_group_bookings.lead_id`) is reused, so a retry after a failed link finishes the job
 *      instead of dying on "booking reference already in use";
 *   3. the link is a version-checked write that retries, and a failure to link is reported as one — never as success.
 */
export async function convertLeadToBookingAction(
  input: ConvertToBookingInput,
): Promise<ConvertToBookingResult> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.convertToBooking) {
    return { ok: false, error: "Your role cannot convert leads to bookings." };
  }
  const parsed = convertToBookingActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_REQUEST };
  const request = parsed.data;

  return guarded<ConvertToBookingResult>(
    "convertLeadToBooking",
    async () => {
      const supabase = await db();
      const { leads } = await loadLeadStore(supabase, { only: ["leads"], leadId: request.leadId });
      const lead = leads[0];
      if (!lead) return { ok: false, error: "That lead no longer exists." };
      if (lead.booking_id) return { ok: false, error: "This lead is already linked to a booking." };
      if (NOT_CONVERTIBLE_STAGES.includes(lead.stage)) {
        return { ok: false, error: "Reopen this lead before converting it to a booking." };
      }
      if (lead.do_not_contact && !who.can.clearDoNotContact) {
        return { ok: false, error: "This customer is marked do-not-contact. An administrator must review that before a booking is made." };
      }

      const link = async (bookingId: string, bookingReference: string): Promise<ConvertToBookingResult> => {
        const linked = await changeOneLead(supabase, request.leadId, (store) =>
          markLeadBookedInStore(
            store,
            { leadId: request.leadId, bookingId, bookingReference, actorName: who.name },
            new Date().toISOString(),
          ),
        );
        if (!linked.ok) {
          return {
            ok: false,
            error: `Booking ${bookingReference} was created but could not be linked to this lead. Press Convert again to finish linking it.`,
          };
        }
        revalidateLeads();
        revalidatePath("/departure-groups");
        return { ok: true, bookingReference };
      };

      // A booking already made from this lead (an earlier attempt that did not get to link it) is finished, not duplicated.
      const { data: existing, error: existingError } = await supabase
        .from("departure_group_bookings")
        .select("id, booking_reference")
        .eq("lead_id", request.leadId)
        .limit(1)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) return link(String(existing.id), String(existing.booking_reference));

      const staleBefore = new Date(Date.now() - CONVERSION_CLAIM_TTL_MS).toISOString();
      const { data: claimed, error: claimError } = await supabase
        .from("leads")
        .update({ converting_at: new Date().toISOString() })
        .eq("id", request.leadId)
        .is("booking_id", null)
        .or(`converting_at.is.null,converting_at.lt.${staleBefore}`)
        .select("id");
      // 42703 = the column is not there yet (20270201090000 not applied): convert without a claim rather than not at all.
      if (claimError && claimError.code !== "42703") throw claimError;
      if (!claimError && (!claimed || claimed.length === 0)) {
        return { ok: false, error: "This lead is already being converted. Try again in a moment." };
      }

      const releaseClaim = async () => {
        await supabase.from("leads").update({ converting_at: null }).eq("id", request.leadId).is("booking_id", null);
      };

      try {
        const travellerCount = request.adults + request.children;
        const bookingOutcome = await createGroupBooking({
          departureGroupId: request.departureGroupId,
          leadId: request.leadId,
          bookingReference: `LD-${lead.reference.replace(/^LD-/, "")}`,
          bookingStatus: "DEPOSIT_PENDING",
          primaryContactName: request.primaryContactName || lead.full_name,
          primaryContactPhone: request.primaryContactPhone || lead.mobile,
          travellerCount,
          roomOccupancyPreference: request.roomOccupancyPreference,
          packagePricePerPerson: request.packagePricePerPerson,
          amountPaid: 0,
        });

        if (!bookingOutcome.ok) {
          await releaseClaim();
          return bookingOutcome;
        }

        const result = await link(bookingOutcome.result.bookingId, bookingOutcome.result.bookingReference);
        if (!result.ok) await releaseClaim();
        return result;
      } catch (cause) {
        await releaseClaim();
        throw cause;
      }
    },
    (error) => ({ ok: false, error }),
  );
}

/* ── Lead sources (Manage Lead Sources) ──────────────────────────────────── */

export async function upsertLeadSourceAction(input: {
  /** Ignored: a source is identified by its code within the agency. */
  id?: string;
  code: string;
  label: string;
  active: boolean;
}): Promise<MutationOutcome> {
  await requireUser();
  const who = await getLeadActor();
  if (!who.can.manageSourcesAndAutomation) {
    return { ok: false, error: "Your role cannot manage lead sources." };
  }
  const parsed = leadSourceActionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_REQUEST };
  }

  return guarded<MutationOutcome>(
    "upsertLeadSource",
    async () => {
      // A source is unique per agency (`lead_sources_code_agency_unique`), so that — not `code` alone — is the conflict target.
      const { error } = await (await db())
        .from("lead_sources")
        .upsert(parsed.data, { onConflict: "agency_id,code" });
      if (error) throw error;

      revalidateLeads();
      return { ok: true };
    },
    (error) => ({ ok: false, error }),
  );
}
