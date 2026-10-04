/**
 * Class-2 flight proposal kinds — see accommodation.ts's header for the
 * shared contract this mirrors.
 */

import { z } from "zod";

import { mutate } from "@/lib/data/departure-groups";
import {
  markFlightTicketsIssuedInStore,
  recordFlightTicketingInStore,
  upsertFlightInStore,
} from "@/lib/data/departure-groups-flights";
import type { LegacyProposalExecutor } from "@/lib/agent/kernel/proposals/executor";

/* ── FLIGHT_UPSERT ─────────────────────────────────────────────────────────── */

const UpsertSchema = z.object({
  flightId: z.string().uuid().optional(),
  direction: z.enum(["OUTBOUND", "RETURN"]),
  status: z.enum(["DRAFT", "HELD", "CONFIRMED", "TICKETED", "CANCELLED"]),
  airline: z.string().min(1),
  flightNumber: z.string().nullish(),
  pnr: z.string().nullish(),
  bookingReference: z.string().nullish(),
  originAirportCode: z.string().min(1),
  originAirportName: z.string().min(1),
  destinationAirportCode: z.string().min(1),
  destinationAirportName: z.string().min(1),
  departureAt: z.string(),
  arrivalAt: z.string(),
  cabinClass: z.string().min(1),
  seatCapacity: z.number().int().nonnegative(),
  seatsHeld: z.number().int().nonnegative(),
  ticketingDeadline: z.string().nullish(),
  supplierName: z.string().nullish(),
  notes: z.string().nullish(),
});
type UpsertPayload = z.infer<typeof UpsertSchema>;

export const flightUpsertExecutor: LegacyProposalExecutor<UpsertPayload> = {
  kind: "FLIGHT_UPSERT",
  schema: UpsertSchema,
  requiredCapability: "manageFlights",
  risk: "HIGH",
  ttlHours: 48,
  fingerprint: (p) => `FLIGHT_UPSERT:${p.flightId ?? p.direction}`,
  dependencySnapshot: (p, snapshot) => {
    const f = snapshot.suppliers.flights.find((row) => row.direction === p.direction);
    return { status: f?.status ?? null, hasPnr: f?.hasPnr ?? null };
  },
  describe: (p, snapshot) => {
    const f = snapshot.suppliers.flights.find((row) => row.direction === p.direction);
    return {
      humanDiff: [
        { field: "status", from: f?.status ?? null, to: p.status },
        { field: "airline", from: null, to: p.airline },
      ],
    };
  },
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        upsertFlightInStore(
          store,
          {
            id: p.flightId,
            departureGroupId: ctx.groupId,
            direction: p.direction,
            status: p.status,
            airline: p.airline,
            flightNumber: p.flightNumber,
            pnr: p.pnr,
            bookingReference: p.bookingReference,
            originAirportCode: p.originAirportCode,
            originAirportName: p.originAirportName,
            destinationAirportCode: p.destinationAirportCode,
            destinationAirportName: p.destinationAirportName,
            departureAt: p.departureAt,
            arrivalAt: p.arrivalAt,
            cabinClass: p.cabinClass,
            seatCapacity: p.seatCapacity,
            seatsHeld: p.seatsHeld,
            ticketingDeadline: p.ticketingDeadline,
            supplierName: p.supplierName,
            notes: p.notes,
          },
          actor,
        ),
      { actor: ctx.actor },
    ),
};

/* ── FLIGHT_RECORD_TICKETING ──────────────────────────────────────────────── */

const RecordTicketingSchema = z.object({
  flightId: z.string().uuid(),
  // OpsSnapshotFlight is keyed by direction, not id (F1 of the plan's own
  // snapshot doesn't carry flight ids) — the dependency check matches on
  // this rather than the opaque flightId.
  direction: z.enum(["OUTBOUND", "RETURN"]),
  pnr: z.string().min(1),
  bookingReference: z.string().nullish(),
});
type RecordTicketingPayload = z.infer<typeof RecordTicketingSchema>;

export const flightRecordTicketingExecutor: LegacyProposalExecutor<RecordTicketingPayload> = {
  kind: "FLIGHT_RECORD_TICKETING",
  schema: RecordTicketingSchema,
  requiredCapability: "manageFlights",
  risk: "HIGH",
  ttlHours: 24,
  fingerprint: (p) => `FLIGHT_RECORD_TICKETING:${p.flightId}`,
  dependencySnapshot: (p, snapshot) => {
    const f = snapshot.suppliers.flights.find((row) => row.direction === p.direction);
    return { hasPnr: f?.hasPnr ?? null, status: f?.status ?? null };
  },
  describe: (p) => ({ humanDiff: [{ field: "pnr", from: null, to: p.pnr }] }),
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        recordFlightTicketingInStore(
          store,
          { flightId: p.flightId, departureGroupId: ctx.groupId, pnr: p.pnr, bookingReference: p.bookingReference },
          actor,
        ),
      { actor: ctx.actor },
    ),
};

/* ── FLIGHT_MARK_TICKETS_ISSUED ───────────────────────────────────────────── */

const MarkTicketsIssuedSchema = z.object({
  flightId: z.string().uuid(),
});
type MarkTicketsIssuedPayload = z.infer<typeof MarkTicketsIssuedSchema>;

export const flightMarkTicketsIssuedExecutor: LegacyProposalExecutor<MarkTicketsIssuedPayload> = {
  kind: "FLIGHT_MARK_TICKETS_ISSUED",
  schema: MarkTicketsIssuedSchema,
  requiredCapability: "manageFlights",
  risk: "HIGH",
  ttlHours: 24,
  fingerprint: (p) => `FLIGHT_MARK_TICKETS_ISSUED:${p.flightId}`,
  dependencySnapshot: (_p, snapshot) => ({
    outboundStatus: snapshot.suppliers.flights.find((f) => f.direction === "OUTBOUND")?.status ?? null,
  }),
  describe: () => ({ humanDiff: [{ field: "status", from: "CONFIRMED", to: "TICKETED" }] }),
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        markFlightTicketsIssuedInStore(store, { flightId: p.flightId, departureGroupId: ctx.groupId }, actor),
      { actor: ctx.actor },
    ),
};
