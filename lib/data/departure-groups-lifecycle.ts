/**
 * Group-level lifecycle and detail edits, kept pure and store-passing so they
 * can be unit-tested without the Next server runtime (mirroring
 * `departure-groups-readiness.ts`). The thin wrappers in `departure-groups.ts`
 * supply the live store.
 *
 * Everything here writes the group row itself, which is why it is separated
 * from the per-entity modules: a capacity edit reflows seat availability, a
 * departure-date edit reflows every date-bound readiness item, and cancelling
 * the group cascades into every booking on it.
 */

import { cancelGroupBookingInStore } from "@/lib/data/departure-groups-bookings";
import { addDays, daysBetween } from "@/lib/data/departure-groups-copy";
import { newId } from "@/lib/data/departure-groups-ids";
import type {
  DepartureGroupRow,
  DepartureGroupStatus,
  GroupActor,
  GroupSalesStatus,
  NusukStatus,
  DepartureGroupStore,
} from "@/lib/types/departure-groups";

/* ── Shared helpers ───────────────────────────────────────────────────────── */

/** The calendar day a timestamp falls on, for comparing against date columns. */
function today(now: string): string {
  return now.slice(0, 10);
}

/** Availability is always derived, never stored independently of the counts. */
function reconcileSeats(group: DepartureGroupRow): void {
  group.available_seats = Math.max(
    group.capacity - group.booked_seats - group.held_seats,
    0,
  );
}

/* ── Edit group details ───────────────────────────────────────────────────── */

/**
 * A reprice. Every field is independently optional — an operator adjusting
 * just the quad rate should not have to resupply the rest. Applying one
 * NEVER rewrites `package_price_per_person` on any existing booking: a
 * booking's agreed price is a contract with that traveller, not a read of
 * the group's list price, and repricing the departure must not silently
 * change what someone already booked.
 */
export interface UpdateGroupPricingInput {
  currency?: string;
  quadPrice?: number | null;
  triplePrice?: number | null;
  doublePrice?: number | null;
  singlePrice?: number | null;
  childPrice?: number | null;
  infantPrice?: number | null;
  earlyBirdPrice?: number | null;
  advanceDeposit?: number | null;
}

export interface UpdateGroupDetailsInput {
  groupId: string;
  groupName?: string;
  groupCode?: string;
  departureDate?: string;
  returnDate?: string;
  capacity?: number;
  minimumGroupSize?: number;
  salesStatus?: GroupSalesStatus;
  branch?: string;
  operationsOwnerName?: string | null;
  primaryGuideName?: string | null;
  visaOwnerName?: string | null;
  financeOwnerName?: string | null;
  localCoordinatorName?: string | null;
  localCoordinatorPhone?: string | null;
  waitlistEnabled?: boolean;
  seatHoldExpiryHours?: number;
  /** Present only when the caller holds the reprice capability — see the Server Action. */
  pricing?: UpdateGroupPricingInput;
  /**
   * The one line of `departure_group_cost_estimates` that has no template
   * equivalent — a coach, a guide's fee, ground handling: costs that do not
   * shrink when the group is smaller. Gated the same way as `pricing`.
   */
  costEstimate?: { fixedCostPerDeparture?: number };
  /** Masar Nusuk / regulatory identifiers — gated on `manageDocumentsAndVisa`. */
  umrahCompanyName?: string | null;
  nusukProgramRef?: string | null;
  nusukGroupRef?: string | null;
  visaBatchRef?: string | null;
  visaInvoiceRef?: string | null;
  nusukStatus?: NusukStatus;
}

export type UpdateGroupDetailsOutcome =
  | {
      ok: true;
      result: {
        groupName: string;
        changedFields: string[];
        rescheduledReadinessItems: number;
      };
    }
  | { ok: false; error: string };

/**
 * Edits a group's own details.
 *
 * Three consequences are handled here rather than left to the caller:
 *
 *   * Capacity may never fall below the seats already committed — an agency
 *     cannot un-sell a booking by editing a number — and availability is
 *     recomputed from the live counts afterwards.
 *   * Duration is derived from the dates, so it is never accepted as an input.
 *   * Moving the departure date drags every `DAYS_BEFORE_DEPARTURE` readiness
 *     item with it. Leaving those pinned to the old date would silently mark a
 *     freshly rescheduled group as overdue.
 */
export function updateGroupDetailsInStore(
  data: DepartureGroupStore,
  input: UpdateGroupDetailsInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): UpdateGroupDetailsOutcome {
  const group = data.groups.find((g) => g.id === input.groupId);
  if (!group) {
    return { ok: false, error: "That departure group no longer exists." };
  }
  if (group.group_status === "CANCELLED") {
    return { ok: false, error: "A cancelled group can no longer be edited." };
  }

  const departureDate = input.departureDate ?? group.departure_date;
  const returnDate = input.returnDate ?? group.return_date;
  if (returnDate < departureDate) {
    return {
      ok: false,
      error: "Return date cannot be before the departure date.",
    };
  }

  if (input.capacity !== undefined) {
    const committed = group.booked_seats + group.held_seats;
    if (input.capacity < committed) {
      return {
        ok: false,
        error: `Capacity cannot drop below the ${committed} seat${
          committed === 1 ? "" : "s"
        } already booked or held. Cancel or move bookings first.`,
      };
    }
  }

  const minimumGroupSize = input.minimumGroupSize ?? group.minimum_group_size;
  const capacity = input.capacity ?? group.capacity;
  if (capacity < minimumGroupSize) {
    return {
      ok: false,
      error: "Capacity cannot be below the minimum group size.",
    };
  }

  if (input.groupCode) {
    const code = input.groupCode.trim().toUpperCase();
    if (
      data.groups.some(
        (g) => g.id !== group.id && g.group_code.toUpperCase() === code,
      )
    ) {
      return { ok: false, error: `Group code ${code} is already in use.` };
    }
  }

  const CLOSED_FOR_PRICING: DepartureGroupStatus[] = [
    "DEPARTED",
    "COMPLETED",
    "CLOSED",
  ];
  if (input.pricing && CLOSED_FOR_PRICING.includes(group.group_status)) {
    return {
      ok: false,
      error:
        "This departure has already flown — its price can no longer be changed.",
    };
  }
  if (
    input.costEstimate &&
    CLOSED_FOR_PRICING.includes(group.group_status)
  ) {
    return {
      ok: false,
      error:
        "This departure has already flown — its cost estimate can no longer be changed.",
    };
  }

  if (input.pricing) {
    // `groupPricingInputSchema` already rejects a deposit exceeding a quad
    // price sent together in the same request; this catches the case that
    // schema cannot — a caller updating the deposit alone, against a quad
    // price that already exists on the row.
    const existingPricing = data.pricing.find(
      (p) => p.departure_group_id === group.id,
    );
    const effectiveQuad =
      input.pricing.quadPrice !== undefined
        ? input.pricing.quadPrice
        : (existingPricing?.quad_price ?? null);
    const effectiveDeposit =
      input.pricing.advanceDeposit !== undefined
        ? input.pricing.advanceDeposit
        : (existingPricing?.advance_deposit ?? null);
    if (
      effectiveDeposit !== null &&
      effectiveQuad !== null &&
      effectiveDeposit > effectiveQuad
    ) {
      return {
        ok: false,
        error: "Advance deposit cannot exceed the Quad price.",
      };
    }
  }

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const changedFields: string[] = [];

  const set = <K extends keyof DepartureGroupRow>(
    key: K,
    value: DepartureGroupRow[K],
    label: string,
  ) => {
    if (group[key] === value) return;
    before[key] = group[key];
    group[key] = value;
    after[key] = value;
    changedFields.push(label);
  };

  if (input.groupName !== undefined) {
    set("group_name", input.groupName.trim(), "name");
  }
  if (input.groupCode !== undefined) {
    set("group_code", input.groupCode.trim().toUpperCase(), "code");
  }
  if (input.branch !== undefined) set("branch", input.branch.trim(), "branch");
  if (input.salesStatus !== undefined) {
    set("sales_status", input.salesStatus, "sales status");
  }
  if (input.capacity !== undefined) set("capacity", input.capacity, "capacity");
  if (input.minimumGroupSize !== undefined) {
    set("minimum_group_size", input.minimumGroupSize, "minimum group size");
  }
  if (input.waitlistEnabled !== undefined) {
    set("waitlist_enabled", input.waitlistEnabled, "waitlist");
  }
  if (input.seatHoldExpiryHours !== undefined) {
    set("seat_hold_expiry_hours", input.seatHoldExpiryHours, "seat hold expiry");
  }
  if (input.operationsOwnerName !== undefined) {
    set(
      "operations_owner_name",
      input.operationsOwnerName?.trim() || null,
      "operations owner",
    );
  }
  if (input.primaryGuideName !== undefined) {
    set(
      "primary_guide_name",
      input.primaryGuideName?.trim() || null,
      "primary guide",
    );
  }
  if (input.visaOwnerName !== undefined) {
    set("visa_owner_name", input.visaOwnerName?.trim() || null, "visa owner");
  }
  if (input.financeOwnerName !== undefined) {
    set(
      "finance_owner_name",
      input.financeOwnerName?.trim() || null,
      "finance owner",
    );
  }
  if (input.localCoordinatorName !== undefined) {
    set(
      "local_coordinator_name",
      input.localCoordinatorName?.trim() || null,
      "local coordinator",
    );
  }
  if (input.localCoordinatorPhone !== undefined) {
    set(
      "local_coordinator_phone",
      input.localCoordinatorPhone?.trim() || null,
      "coordinator phone",
    );
  }
  if (input.umrahCompanyName !== undefined) {
    set(
      "umrah_company_name",
      input.umrahCompanyName?.trim() || null,
      "Umrah company",
    );
  }
  if (input.nusukProgramRef !== undefined) {
    set(
      "nusuk_program_ref",
      input.nusukProgramRef?.trim() || null,
      "Nusuk program reference",
    );
  }
  if (input.nusukGroupRef !== undefined) {
    set(
      "nusuk_group_ref",
      input.nusukGroupRef?.trim() || null,
      "Nusuk group reference",
    );
  }
  if (input.visaBatchRef !== undefined) {
    set(
      "visa_batch_ref",
      input.visaBatchRef?.trim() || null,
      "visa batch reference",
    );
  }
  if (input.visaInvoiceRef !== undefined) {
    set(
      "visa_invoice_ref",
      input.visaInvoiceRef?.trim() || null,
      "visa invoice reference",
    );
  }
  if (input.nusukStatus !== undefined) {
    set("nusuk_status", input.nusukStatus, "Nusuk status");
  }

  const departureShift = daysBetween(group.departure_date, departureDate);
  set("departure_date", departureDate, "departure date");
  set("return_date", returnDate, "return date");

  const durationDays = daysBetween(departureDate, returnDate) + 1;
  group.duration_days = durationDays;
  group.duration_nights = Math.max(durationDays - 1, 0);

  reconcileSeats(group);

  // Date-bound checklist items follow the departure date they were derived from.
  let rescheduledReadinessItems = 0;
  if (departureShift !== 0) {
    for (const item of data.readinessItems) {
      if (item.departure_group_id !== group.id) continue;
      if (item.due_type !== "DAYS_BEFORE_DEPARTURE" || !item.due_at) continue;
      const [date, time] = item.due_at.split("T");
      item.due_at = time
        ? `${addDays(date, departureShift)}T${time}`
        : addDays(date, departureShift);
      rescheduledReadinessItems++;
    }
  }

  // Repricing touches its own table (`departure_group_pricing`), never the
  // group row, and is logged as its own activity entry rather than folded
  // into "Group details updated" — it is the highest-impact edit this
  // function makes and deserves its own message and its own before/after.
  let repriceMessage: string | null = null;
  if (input.pricing) {
    const pricingRow = data.pricing.find(
      (p) => p.departure_group_id === group.id,
    );
    if (pricingRow) {
      const priceBefore = { ...pricingRow };
      const changedPriceFields: string[] = [];

      const setPrice = <K extends keyof UpdateGroupPricingInput>(
        key: K,
        column: keyof typeof pricingRow,
        label: string,
      ) => {
        const value = input.pricing![key];
        if (value === undefined) return;
        const row = pricingRow as unknown as Record<string, unknown>;
        if (row[column as string] === value) return;
        row[column as string] = value;
        changedPriceFields.push(label);
      };

      setPrice("currency", "currency", "currency");
      setPrice("quadPrice", "quad_price", "quad price");
      setPrice("triplePrice", "triple_price", "triple price");
      setPrice("doublePrice", "double_price", "double price");
      setPrice("singlePrice", "single_price", "single price");
      setPrice("childPrice", "child_price", "child price");
      setPrice("infantPrice", "infant_price", "infant price");
      setPrice("earlyBirdPrice", "early_bird_price", "early bird price");
      setPrice("advanceDeposit", "advance_deposit", "advance deposit");

      if (changedPriceFields.length > 0) {
        pricingRow.price_source = "OVERRIDDEN";
        pricingRow.priced_by = actor.id;
        pricingRow.priced_at = now;
        pricingRow.updated_at = now;
        changedFields.push("pricing");

        const liveBookings = data.bookings.filter(
          (b) =>
            b.departure_group_id === group.id && b.booking_status !== "CANCELLED",
        ).length;
        repriceMessage =
          `Price updated: ${changedPriceFields.join(", ")}.` +
          (liveBookings > 0
            ? ` ${liveBookings} existing booking${liveBookings === 1 ? "" : "s"} keep${liveBookings === 1 ? "s" : ""} its agreed price.`
            : "");

        data.activity.push({
          id: newId(),
          departure_group_id: group.id,
          actor_id: actor.id,
          actor_name_snapshot: actor.name,
          action_type: "GROUP_REPRICED",
          entity_type: "GROUP",
          entity_id: group.id,
          before_value: priceBefore,
          after_value: { ...pricingRow },
          message: repriceMessage,
          is_system: false,
          is_high_impact: true,
          created_at: now,
        });
      }
    }
  }

  // The one cost line with no template equivalent — fixed, per-departure
  // costs (coach, guide, ground handling) that do not shrink with headcount.
  if (input.costEstimate?.fixedCostPerDeparture !== undefined) {
    const costRow = data.costEstimates.find(
      (c) => c.departure_group_id === group.id,
    );
    if (costRow && costRow.fixed_cost_per_departure !== input.costEstimate.fixedCostPerDeparture) {
      const before = costRow.fixed_cost_per_departure;
      costRow.fixed_cost_per_departure = input.costEstimate.fixedCostPerDeparture;
      costRow.updated_at = now;
      costRow.updated_by = actor.id;
      changedFields.push("fixed cost per departure");

      data.activity.push({
        id: newId(),
        departure_group_id: group.id,
        actor_id: actor.id,
        actor_name_snapshot: actor.name,
        action_type: "GROUP_COST_ESTIMATE_UPDATED",
        entity_type: "GROUP",
        entity_id: group.id,
        before_value: { fixed_cost_per_departure: before },
        after_value: { fixed_cost_per_departure: costRow.fixed_cost_per_departure },
        message: `Fixed cost per departure updated from ${before} to ${costRow.fixed_cost_per_departure}.`,
        is_system: false,
        is_high_impact: true,
        created_at: now,
      });
    }
  }

  if (changedFields.length === 0) {
    return {
      ok: true,
      result: {
        groupName: group.group_name,
        changedFields: [],
        rescheduledReadinessItems: 0,
      },
    };
  }

  group.updated_at = now;

  const reflow =
    rescheduledReadinessItems > 0
      ? ` ${rescheduledReadinessItems} date-bound readiness item${
          rescheduledReadinessItems === 1 ? "" : "s"
        } rescheduled.`
      : "";

  // Pricing already got its own, more specific `GROUP_REPRICED` entry above —
  // logging it again here (as a bare, no-detail "pricing" bullet) would just
  // be noise on the trail. Only push this generic entry when something on the
  // group ROW itself changed.
  const rowFieldsChanged = changedFields.filter(
    (f) => f !== "pricing" && f !== "fixed cost per departure",
  );

  if (rowFieldsChanged.length > 0) {
    data.activity.push({
      id: newId(),
      departure_group_id: group.id,
      actor_id: actor.id,
      actor_name_snapshot: actor.name,
      action_type: "GROUP_UPDATED",
      entity_type: "GROUP",
      entity_id: group.id,
      before_value: before,
      after_value: after,
      message: `Group details updated: ${rowFieldsChanged.join(", ")}.${reflow}`,
      is_system: false,
      is_high_impact:
        changedFields.includes("departure date") ||
        changedFields.includes("capacity") ||
        changedFields.includes("return date"),
      created_at: now,
    });
  }

  return {
    ok: true,
    result: {
      groupName: group.group_name,
      changedFields,
      rescheduledReadinessItems,
    },
  };
}

/* ── Lifecycle transitions ────────────────────────────────────────────────── */

/**
 * `PLANNING → PREPARING → READY_TO_DEPART → DEPARTED → COMPLETED → CLOSED`,
 * with `CANCELLED` reachable from anything before departure.
 *
 * Only `MARK_READY` and `CANCEL` used to exist, so four of the seven states in
 * the schema had no writer at all: a group could be marked ready and then never
 * depart, never complete and never close. The KPI cards counting departed and
 * completed groups were reading columns nothing could ever set.
 *
 * `PREPARING` is not in this list deliberately — it is entered automatically
 * when the group takes its first booking (see `advanceGroupToPreparing`), since
 * that is what "preparing" means and asking someone to click it would only
 * introduce another thing to forget.
 */
export type GroupLifecycleAction =
  | "CLOSE_SALES"
  | "REOPEN_SALES"
  | "MARK_READY"
  | "MARK_DEPARTED"
  | "MARK_COMPLETED"
  | "CLOSE_GROUP"
  | "CANCEL";


export type GroupLifecycleOutcome =
  | {
      ok: true;
      result: {
        groupName: string;
        groupStatus: DepartureGroupStatus;
        salesStatus: GroupSalesStatus;
        /** Bookings cancelled by a CANCEL cascade; zero for every other action. */
        cancelledBookings: number;
        refundPendingAmount: number;
      };
    }
  | { ok: false; error: string };

/**
 * Applies a group-level lifecycle transition.
 *
 * Cancelling is the only one that cascades: every live booking is withdrawn
 * through the same `cancelGroupBookingInStore` path a single cancellation uses,
 * so seats, rooming, traveller statuses and the refund liability are all
 * reconciled exactly as they would be one booking at a time. Money already
 * collected becomes refund-pending in full — when the agency cancels, the
 * pilgrim is owed their money back.
 */
export function setGroupLifecycleInStore(
  data: DepartureGroupStore,
  input: { groupId: string; action: GroupLifecycleAction; reason?: string },
  actor: GroupActor,
  now: string = new Date().toISOString(),
): GroupLifecycleOutcome {
  const group = data.groups.find((g) => g.id === input.groupId);
  if (!group) {
    return { ok: false, error: "That departure group no longer exists." };
  }
  if (group.group_status === "CANCELLED") {
    return { ok: false, error: "This group has already been cancelled." };
  }

  const beforeSales = group.sales_status;
  const beforeStatus = group.group_status;
  let cancelledBookings = 0;
  let refundPendingAmount = 0;
  let message: string;
  let actionType: string;

  switch (input.action) {
    case "CLOSE_SALES": {
      if (group.sales_status === "SALES_CLOSED") {
        return { ok: false, error: "Sales are already closed for this group." };
      }
      group.sales_status = "SALES_CLOSED";
      actionType = "GROUP_SALES_CLOSED";
      message =
        "Sales closed. New bookings are blocked; existing bookings, holds and the waitlist are unaffected.";
      break;
    }

    case "REOPEN_SALES": {
      if (group.sales_status !== "SALES_CLOSED") {
        return { ok: false, error: "Sales are not closed for this group." };
      }
      if (
        group.group_status === "DEPARTED" ||
        group.group_status === "COMPLETED" ||
        group.group_status === "CLOSED"
      ) {
        return {
          ok: false,
          error: "This group has already departed — its seats cannot be sold again.",
        };
      }
      if (group.available_seats <= 0 && !group.waitlist_enabled) {
        return {
          ok: false,
          error:
            "There are no seats left to sell. Raise the capacity or enable the waitlist first.",
        };
      }
      group.sales_status =
        group.available_seats <= 0
          ? "WAITLIST"
          : group.available_seats <= Math.ceil(group.capacity * 0.1)
            ? "LIMITED_AVAILABILITY"
            : "SELLING";
      actionType = "GROUP_SALES_REOPENED";
      message = `Sales reopened with ${group.available_seats} seat${
        group.available_seats === 1 ? "" : "s"
      } available.`;
      break;
    }

    case "MARK_READY": {
      if (group.group_status === "READY_TO_DEPART") {
        return {
          ok: false,
          error: "This group is already marked ready to depart.",
        };
      }
      if (
        group.group_status === "DEPARTED" ||
        group.group_status === "COMPLETED" ||
        group.group_status === "CLOSED"
      ) {
        return {
          ok: false,
          error: "This group has already departed — readiness is settled.",
        };
      }

      /**
       * Ready means the checklist is done, not merely un-blocked.
       *
       * This gate used to reject only items explicitly set to `BLOCKED`, which
       * meant a group with every requirement still at `NOT_STARTED` — no PNR,
       * no hotel, no visas — passed, because nobody had gone in and marked
       * anything blocked. Now that the operational items derive themselves
       * from the real rows, "every required item complete" is a statement about
       * the group rather than about who remembered to tick what.
       */
      const required = data.readinessItems.filter(
        (item) =>
          item.departure_group_id === group.id &&
          item.required &&
          item.status !== "NOT_REQUIRED",
      );
      if (required.length === 0) {
        return {
          ok: false,
          error:
            "This group has no readiness checklist, so there is nothing to certify. Add the requirements first.",
        };
      }

      const outstanding = required.filter((item) => item.status !== "COMPLETE");
      if (outstanding.length > 0) {
        const blocked = outstanding.filter((item) => item.status === "BLOCKED");
        const lead = blocked.length > 0 ? blocked : outstanding;
        return {
          ok: false,
          error: `${outstanding.length} required readiness item${
            outstanding.length === 1 ? " is" : "s are"
          } not complete${blocked.length > 0 ? ` (${blocked.length} blocked)` : ""}: ${lead
            .slice(0, 3)
            .map((item) => item.label)
            .join(", ")}${lead.length > 3 ? "…" : ""}.`,
        };
      }

      group.group_status = "READY_TO_DEPART";
      group.ready_at = now;
      actionType = "GROUP_MARKED_READY";
      message = `Group marked ready to depart — all ${required.length} required readiness items complete.`;
      break;
    }

    case "MARK_DEPARTED": {
      if (group.group_status === "DEPARTED") {
        return { ok: false, error: "This group has already departed." };
      }
      if (
        group.group_status === "COMPLETED" ||
        group.group_status === "CLOSED"
      ) {
        return { ok: false, error: "This group has already returned." };
      }
      if (group.group_status !== "READY_TO_DEPART") {
        return {
          ok: false,
          error: "Mark the group ready to depart before recording the departure.",
        };
      }
      // Recording a departure that has not happened yet would put travellers in
      // the air on the manifest and stop anyone fixing their paperwork.
      if (today(now) < group.departure_date) {
        return {
          ok: false,
          error: `This group departs on ${group.departure_date}. Record the departure on the day.`,
        };
      }

      group.group_status = "DEPARTED";
      group.departed_at = now;
      // Nothing more can be sold into a group that is in the air.
      group.sales_status = "SALES_CLOSED";

      let flown = 0;
      for (const pilgrim of data.pilgrims) {
        if (pilgrim.departure_group_id !== group.id) continue;
        if (pilgrim.seat_status === "CANCELLED") continue;
        if (pilgrim.seat_status === "WAITLIST") continue;
        pilgrim.seat_status = "TICKETED";
        flown++;
      }

      // A waitlist cannot outlive the flight it was waiting for.
      let waitlistClosed = 0;
      for (const booking of data.bookings) {
        if (booking.departure_group_id !== group.id) continue;
        if (booking.booking_status !== "WAITLIST") continue;
        booking.booking_status = "CANCELLED";
        booking.waitlist_position = null;
        waitlistClosed++;
      }
      if (waitlistClosed > 0) {
        for (const pilgrim of data.pilgrims) {
          if (pilgrim.departure_group_id !== group.id) continue;
          if (pilgrim.seat_status === "WAITLIST") {
            pilgrim.seat_status = "CANCELLED";
          }
        }
      }

      actionType = "GROUP_DEPARTED";
      message = `Group departed with ${flown} traveller${flown === 1 ? "" : "s"}.${
        waitlistClosed > 0
          ? ` ${waitlistClosed} waitlisted booking${waitlistClosed === 1 ? "" : "s"} closed.`
          : ""
      }`;
      break;
    }

    case "MARK_COMPLETED": {
      if (group.group_status === "COMPLETED") {
        return { ok: false, error: "This group is already marked completed." };
      }
      if (group.group_status === "CLOSED") {
        return { ok: false, error: "This group has already been closed." };
      }
      if (group.group_status !== "DEPARTED") {
        return {
          ok: false,
          error: "Record the departure before marking the group completed.",
        };
      }
      if (today(now) < group.return_date) {
        return {
          ok: false,
          error: `This group returns on ${group.return_date}. Mark it completed once the travellers are back.`,
        };
      }

      group.group_status = "COMPLETED";
      group.completed_at = now;
      actionType = "GROUP_COMPLETED";
      message = "Group completed — travellers returned. Settle the remaining supplier and refund balances to close it.";
      break;
    }

    case "CLOSE_GROUP": {
      if (group.group_status === "CLOSED") {
        return { ok: false, error: "This group is already closed." };
      }
      if (group.group_status !== "COMPLETED") {
        return {
          ok: false,
          error: "Only a completed group can be closed.",
        };
      }

      /**
       * Closing is the financial full stop: after it the group is history and
       * the Payments tab stops being actionable. Doing that with money still
       * moving in either direction would strand a debt or a refund with no
       * screen left to chase it from.
       */
      const owing = data.bookings.filter(
        (b) =>
          b.departure_group_id === group.id &&
          b.booking_status !== "CANCELLED" &&
          b.outstanding_balance > 0,
      );
      if (owing.length > 0) {
        const total = owing.reduce((sum, b) => sum + b.outstanding_balance, 0);
        return {
          ok: false,
          error: `${owing.length} booking${owing.length === 1 ? "" : "s"} still owe ${total.toLocaleString("en-US")}. Collect or write the balance off before closing.`,
        };
      }

      const refunds = data.pilgrims.filter(
        (p) =>
          p.departure_group_id === group.id &&
          p.payment_status === "REFUND_PENDING",
      );
      if (refunds.length > 0) {
        return {
          ok: false,
          error: `${refunds.length} traveller${refunds.length === 1 ? " is" : "s are"} still awaiting a refund. Settle those before closing.`,
        };
      }

      group.group_status = "CLOSED";
      group.closed_at = now;
      actionType = "GROUP_CLOSED";
      message = "Group closed. The ledger is settled and the record is now read-only history.";
      break;
    }

    case "CANCEL": {
      // A group in the air cannot be un-departed. What happened after that is a
      // refund or an incident, not a cancellation of the journey itself.
      if (
        group.group_status === "DEPARTED" ||
        group.group_status === "COMPLETED" ||
        group.group_status === "CLOSED"
      ) {
        return {
          ok: false,
          error: "This group has already departed and cannot be cancelled.",
        };
      }

      const reason = input.reason?.trim() || "Departure group cancelled.";
      const live = data.bookings.filter(
        (b) =>
          b.departure_group_id === group.id && b.booking_status !== "CANCELLED",
      );

      for (const booking of live) {
        const outcome = cancelGroupBookingInStore(
          data,
          {
            bookingId: booking.id,
            departureGroupId: group.id,
            reason,
            // The agency is cancelling, so everything collected is owed back.
            refundAmount: booking.amount_paid,
          },
          actor,
          now,
        );
        if (outcome.ok) {
          cancelledBookings++;
          refundPendingAmount += outcome.result.refundAmount;
        }
      }

      group.sales_status = "CANCELLED";
      group.group_status = "CANCELLED";
      group.cancelled_at = now;
      group.cancellation_reason = reason;
      group.held_seats = 0;
      group.booked_seats = 0;
      actionType = "GROUP_CANCELLED";
      message = `Group cancelled. ${cancelledBookings} booking${
        cancelledBookings === 1 ? "" : "s"
      } withdrawn${
        refundPendingAmount > 0
          ? ` with ${refundPendingAmount.toLocaleString("en-US")} pending refund`
          : ""
      }. Supplier bookings must still be cancelled with each supplier directly. Reason: ${reason}`;
      break;
    }
  }

  reconcileSeats(group);
  group.updated_at = now;

  data.activity.push({
    id: newId(),
    departure_group_id: group.id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: actionType,
    entity_type: "GROUP",
    entity_id: group.id,
    before_value: { group_status: beforeStatus, sales_status: beforeSales },
    after_value: {
      group_status: group.group_status,
      sales_status: group.sales_status,
    },
    message,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      groupName: group.group_name,
      groupStatus: group.group_status,
      salesStatus: group.sales_status,
      cancelledBookings,
      refundPendingAmount,
    },
  };
}
