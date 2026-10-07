"use client";

import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { upsertFlightSchema } from "@/lib/validations/departure-groups";
import { format } from "date-fns";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDownIcon,
  Clock,
  Link2,
  Link2Off,
  Loader2,
  Pencil,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  Plus,
  Trash2,
  TimerReset,
  TriangleAlert,
  X,
} from "lucide-react";
import React, { useEffect, useMemo, useState, useTransition } from "react";

import {
  listActiveSuppliersAction,
  removeGroupFlightLegAction,
  updateGroupFlightLegAction,
  upsertGroupFlightAction,
  type ActiveSupplierOption,
} from "../../actions";
import type {
  DepartureGroupFlight,
  FlightDirection,
  FlightStatus,
} from "../../types";
import { SUPPLIER_TYPES_BY_CONTEXT } from "./supplier-picker-types";
import SectionHeading from "@/components/section-heading";
import { Card } from "@/components/ui/card";
import { TONE_BAR, TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";
import {
  DatePicker,
  DateTimePicker,
  toLocalInputValue,
} from "@/components/date-time-picker";

/* ── Labels ─────────────────────────────────────────────────────────────── */

const DIRECTION_LABELS: Record<FlightDirection, string> = {
  OUTBOUND: "Outbound",
  RETURN: "Return",
};

const STATUS_LABELS: Record<FlightStatus, string> = {
  DRAFT: "Draft",
  HELD: "Held",
  CONFIRMED: "Confirmed",
  TICKETED: "Ticketed",
  CANCELLED: "Cancelled",
};

const STATUSES = Object.keys(STATUS_LABELS) as FlightStatus[];

/* ── Local-datetime helpers ─────────────────────────────────────────────── */

function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function minutesBetween(fromValue: string, toValue: string): number | null {
  const from = fromLocalInputValue(fromValue);
  const to = fromLocalInputValue(toValue);
  if (!from || !to) return null;
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/* ── Draft-leg model ────────────────────────────────────────────────────── */

interface DraftLeg {
  key: string;
  /** Present once persisted; used as `id`. */
  id?: string;
  legOrder?: number;
  /** True for legs loaded from the flight; false for stops added in this session. */
  saved: boolean;
  airline: string;
  flightNumber: string;
  destinationCode: string;
  departureAt: string;
  arrivalAt: string;
}

let draftLegSeq = 0;
function nextDraftLegKey(): string {
  draftLegSeq += 1;
  return `draft-leg-${draftLegSeq}`;
}

function legsFromFlight(flight: DepartureGroupFlight | null): DraftLeg[] {
  if (!flight) return [];
  return [...flight.legs]
    .sort((a, b) => a.legOrder - b.legOrder)
    .map((leg) => ({
      key: leg.id,
      id: leg.id,
      legOrder: leg.legOrder,
      saved: true,
      airline: leg.airline,
      flightNumber: leg.flightNumber,
      destinationCode: leg.destinationAirportCode,
      departureAt: toLocalInputValue(leg.departureAt),
      arrivalAt: toLocalInputValue(leg.arrivalAt),
    }));
}

/* ── Small building blocks ──────────────────────────────────────────────── */

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/* ── Sheet ──────────────────────────────────────────────────────────────── */

interface AddEditFlightSheetProps {
  flight: DepartureGroupFlight | null;
  departureGroupId: string;
  existingDirections: FlightDirection[];
  /** ISO date (YYYY-MM-DD) — the trip's start day. */
  groupDepartureDate: string;
  /** ISO date (YYYY-MM-DD) — the trip's end day. */
  groupReturnDate: string;
  /**
   * The other sector already on this group (return if editing outbound, or
   * outbound if editing return). Used only for inline ordering warnings —
   * the server always re-checks.
   */
  otherDirectionFlight: DepartureGroupFlight | null;
  open: boolean;
  onClose: () => void;
}

const AddEditFlightSheet = ({
  flight,
  departureGroupId,
  existingDirections,
  groupDepartureDate,
  groupReturnDate,
  otherDirectionFlight,
  open,
  onClose,
}: AddEditFlightSheetProps) => {
  const [isPending, startTransition] = useTransition();
  const [isLegPending, startLegTransition] = useTransition();
  const [editingLegKey, setEditingLegKey] = useState<string | null>(null);
  const [legBusyKey, setLegBusyKey] = useState<string | null>(null);
  const isEdit = flight !== null;

  const availableDirections = (
    ["OUTBOUND", "RETURN"] as FlightDirection[]
  ).filter((d) => isEdit || !existingDirections.includes(d));

  const [direction, setDirection] = useState<FlightDirection>(
    flight?.direction ?? availableDirections[0] ?? "OUTBOUND",
  );
  const [status, setStatus] = useState<FlightStatus>(flight?.status ?? "DRAFT");
  const [airline, setAirline] = useState(flight?.airline ?? "");
  const [flightNumber, setFlightNumber] = useState(flight?.flightNumber ?? "");
  const [originCode, setOriginCode] = useState(flight?.originAirportCode ?? "");
  const [originName, setOriginName] = useState(flight?.originAirportName ?? "");
  const [destinationCode, setDestinationCode] = useState(
    flight?.destinationAirportCode ?? "",
  );
  const [destinationName, setDestinationName] = useState(
    flight?.destinationAirportName ?? "",
  );
  const [departureAt, setDepartureAt] = useState(
    toLocalInputValue(flight?.departureAt),
  );
  const [arrivalAt, setArrivalAt] = useState(
    toLocalInputValue(flight?.arrivalAt),
  );
  const [cabinClass, setCabinClass] = useState(flight?.cabinClass ?? "Economy");
  const seatsTicketed = flight?.seatsTicketed ?? 0;
  const [seatCapacity, setSeatCapacity] = useState(
    String(flight?.seatCapacity ?? ""),
  );
  const [seatsHeld, setSeatsHeld] = useState(String(flight?.seatsHeld ?? 0));
  const [ticketingDeadline, setTicketingDeadline] = useState(
    toLocalInputValue(flight?.ticketingDeadline),
  );
  const [supplierName, setSupplierName] = useState(flight?.supplierName ?? "");
  const [supplierId, setSupplierId] = useState<string | null>(
    flight?.supplierId ?? null,
  );
  const [supplierOptions, setSupplierOptions] = useState<
    ActiveSupplierOption[]
  >([]);
  const [notes, setNotes] = useState(flight?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [legs, setLegs] = useState<DraftLeg[]>(() => legsFromFlight(flight));
  const [legError, setLegError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    listActiveSuppliersAction([...SUPPLIER_TYPES_BY_CONTEXT.FLIGHT]).then(
      (res) => {
        if (res.ok) setSupplierOptions(res.suppliers);
      },
    );
  }, [open]);

  useResetOnOpen(open, flight?.id ?? "", () => {
    setDirection(flight?.direction ?? availableDirections[0] ?? "OUTBOUND");
    setStatus(flight?.status ?? "DRAFT");
    setAirline(flight?.airline ?? "");
    setFlightNumber(flight?.flightNumber ?? "");
    setOriginCode(flight?.originAirportCode ?? "");
    setOriginName(flight?.originAirportName ?? "");
    setDestinationCode(flight?.destinationAirportCode ?? "");
    setDestinationName(flight?.destinationAirportName ?? "");
    setDepartureAt(toLocalInputValue(flight?.departureAt));
    setArrivalAt(toLocalInputValue(flight?.arrivalAt));
    setCabinClass(flight?.cabinClass ?? "Economy");
    setSeatCapacity(String(flight?.seatCapacity ?? ""));
    setSeatsHeld(String(flight?.seatsHeld ?? 0));
    setTicketingDeadline(toLocalInputValue(flight?.ticketingDeadline));
    setSupplierName(flight?.supplierName ?? "");
    setSupplierId(flight?.supplierId ?? null);
    setNotes(flight?.notes ?? "");
    setError(null);
    setLegs(legsFromFlight(flight));
    setLegError(null);
  });

  const noDirectionsLeft = !isEdit && availableDirections.length === 0;

  const availableStatuses = STATUSES.filter((s) => {
    if (!isEdit || seatsTicketed === 0) return true;
    if (s === "CANCELLED") return false;
    const RANK: Record<FlightStatus, number> = {
      DRAFT: 0,
      HELD: 1,
      CONFIRMED: 2,
      TICKETED: 3,
      CANCELLED: -1,
    };
    return RANK[s] >= RANK[flight?.status ?? "DRAFT"];
  });

  /** Where each stop departs from — inherits from the previous point. */
  const legOrigin = (index: number): string =>
    index === 0
      ? originCode.trim().toUpperCase()
      : legs[index - 1].destinationCode.trim().toUpperCase();

  /* ── Live cross-field warnings ─────────────────────────────────────────── */

  const tripWindowWarning = useMemo(() => {
    if (!departureAt && !arrivalAt) return null;
    if (!groupDepartureDate || !groupReturnDate) return null;
    // The picker state is naive local ("YYYY-MM-DDTHH:mm"), so the first 10
    // chars are the calendar date the operator actually picked — no timezone
    // conversion in the comparison, which is the whole point.
    const depDay = departureAt ? departureAt.slice(0, 10) : "";
    const arrDay = arrivalAt ? arrivalAt.slice(0, 10) : "";
    if (depDay && (depDay < groupDepartureDate || depDay > groupReturnDate)) {
      return `Departure ${depDay} is outside the trip window (${groupDepartureDate} → ${groupReturnDate}).`;
    }
    if (arrDay && (arrDay < groupDepartureDate || arrDay > groupReturnDate)) {
      return `Arrival ${arrDay} is outside the trip window (${groupDepartureDate} → ${groupReturnDate}).`;
    }
    return null;
  }, [departureAt, arrivalAt, groupDepartureDate, groupReturnDate]);

  const orderingWarning = useMemo(() => {
    if (!otherDirectionFlight) return null;
    if (otherDirectionFlight.direction === direction) return null;
    const dep = departureAt
      ? Date.parse(fromLocalInputValue(departureAt) ?? "")
      : NaN;
    const arr = arrivalAt
      ? Date.parse(fromLocalInputValue(arrivalAt) ?? "")
      : NaN;
    const otherDep = Date.parse(otherDirectionFlight.departureAt);
    const otherArr = Date.parse(otherDirectionFlight.arrivalAt);
    if (
      direction === "OUTBOUND" &&
      !Number.isNaN(arr) &&
      !Number.isNaN(otherDep) &&
      arr > otherDep
    ) {
      return `Outbound arrival is after the existing return flight's departure. Fix one of the two.`;
    }
    if (
      direction === "RETURN" &&
      !Number.isNaN(dep) &&
      !Number.isNaN(otherArr) &&
      dep < otherArr
    ) {
      return `Return departure is before the existing outbound flight's arrival. Fix one of the two.`;
    }
    return null;
  }, [departureAt, arrivalAt, direction, otherDirectionFlight]);

  const deadlineWarning = useMemo(() => {
    if (!ticketingDeadline || !departureAt) return null;
    const dep = Date.parse(fromLocalInputValue(departureAt) ?? "");
    const deadline = Date.parse(fromLocalInputValue(ticketingDeadline) ?? "");
    if (Number.isNaN(dep) || Number.isNaN(deadline)) return null;
    return deadline > dep
      ? "Ticketing deadline is after the flight's departure."
      : null;
  }, [ticketingDeadline, departureAt]);

  const journey = useMemo(() => {
    if (legs.length === 0) {
      const inAir = minutesBetween(departureAt, arrivalAt);
      return {
        stops: 0,
        totalMinutes: inAir,
        inAirMinutes: inAir,
        layoverMinutes: null as number | null,
      };
    }
    const total = minutesBetween(
      departureAt || legs[0].departureAt,
      legs[legs.length - 1].arrivalAt || arrivalAt,
    );
    let inAir = 0;
    let hasAllInAir = true;
    for (const leg of legs) {
      const m = minutesBetween(leg.departureAt, leg.arrivalAt);
      if (m === null) hasAllInAir = false;
      else inAir += m;
    }
    return {
      stops: legs.length,
      totalMinutes: total,
      inAirMinutes: hasAllInAir ? inAir : null,
      layoverMinutes:
        total !== null && hasAllInAir ? Math.max(0, total - inAir) : null,
    };
  }, [legs, departureAt, arrivalAt]);

  const addTransitStop = () => {
    setLegError(null);
    setLegs((prev) => {
      // The new leg picks up where the previous point left off — either the
      // flight's own origin (first leg) or the last leg's arrival airport.
      const previousArrivalTime =
        prev.length === 0 ? departureAt : prev[prev.length - 1].arrivalAt;
      return [
        ...prev,
        {
          key: nextDraftLegKey(),
          saved: false,
          // Inherit flight-level airline/# only for the first segment — that
          // is the operator's own carrier; subsequent connecting flights are
          // usually a different airline.
          airline: prev.length === 0 ? airline : "",
          flightNumber: prev.length === 0 ? flightNumber : "",
          // Assume this new leg is the FINAL one landing at the flight's
          // destination. If the operator is inserting an intermediate stop,
          // they'll change the airport code — but the "assumed final leg"
          // default matches how a 1-stop journey is built step by step.
          destinationCode: destinationCode.trim().toUpperCase(),
          departureAt: previousArrivalTime,
          arrivalAt,
        },
      ];
    });
  };

  const removeTransitStop = (key: string) => {
    setLegs((prev) => prev.filter((l) => l.key !== key));
    setLegError(null);
  };

  const updateLeg = (key: string, patch: Partial<DraftLeg>) => {
    setLegs((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  };

  /**
   * A saved leg's fields were unconditionally disabled — once persisted, a
   * typo in its airline, flight number, connecting airport or times could
   * never be fixed short of deleting the whole flight sector and rebuilding
   * it. These three handlers are the edit/delete path that was missing:
   * saved separately from the flight-level "Save" button below, since a
   * transit leg is its own row server-side and editing it doesn't need the
   * rest of the flight's fields to be valid first.
   */
  const startEditingLeg = (leg: DraftLeg) => {
    setEditingLegKey(leg.key);
    setLegError(null);
  };

  const cancelEditingLeg = (leg: DraftLeg) => {
    const original = flight?.legs.find((l) => l.id === leg.id);
    if (original) {
      updateLeg(leg.key, {
        airline: original.airline,
        flightNumber: original.flightNumber,
        destinationCode: original.destinationAirportCode,
        departureAt: toLocalInputValue(original.departureAt),
        arrivalAt: toLocalInputValue(original.arrivalAt),
      });
    }
    setEditingLegKey(null);
    setLegError(null);
  };

  const saveEditedLeg = (leg: DraftLeg) => {
    if (!leg.id) return;
    const idx = legs.findIndex((l) => l.key === leg.key);
    if (
      !leg.airline.trim() ||
      !leg.flightNumber.trim() ||
      !leg.destinationCode.trim() ||
      !leg.departureAt ||
      !leg.arrivalAt
    ) {
      setLegError(`Leg ${idx + 1} is missing required fields.`);
      return;
    }

    setLegError(null);
    setLegBusyKey(leg.key);
    startLegTransition(async () => {
      const result = await updateGroupFlightLegAction({
        legId: leg.id,
        departureGroupId,
        airline: leg.airline.trim(),
        flightNumber: leg.flightNumber.trim(),
        originAirportCode: legOrigin(idx),
        destinationAirportCode: leg.destinationCode.trim(),
        departureAt: fromLocalInputValue(leg.departureAt) ?? "",
        arrivalAt: fromLocalInputValue(leg.arrivalAt) ?? "",
      });
      setLegBusyKey(null);
      if (!result.ok) {
        toast.add({
          title: "Could not save this leg",
          description: result.error,
        });
        return;
      }
      toast.add({ title: "Transit leg updated" });
      setEditingLegKey(null);
    });
  };

  const deleteLeg = (leg: DraftLeg) => {
    if (!leg.id) return;
    setLegBusyKey(leg.key);
    startLegTransition(async () => {
      const result = await removeGroupFlightLegAction({
        legId: leg.id,
        departureGroupId,
      });
      setLegBusyKey(null);
      if (!result.ok) {
        toast.add({
          title: "Could not remove this leg",
          description: result.error,
        });
        return;
      }
      toast.add({ title: "Transit leg removed" });
      setLegs((prev) => prev.filter((l) => l.key !== leg.key));
      if (editingLegKey === leg.key) setEditingLegKey(null);
    });
  };

  const submit = () => {
    setError(null);
    setLegError(null);

    // Hard-block anything outside the trip window / with bad ordering / with
    // a ticketing deadline after departure. These are cross-field rules the
    // Zod schema can't express, but they're not negotiable — the server
    // rejects them too.
    if (tripWindowWarning) {
      setError(tripWindowWarning);
      return;
    }
    if (orderingWarning) {
      setError(orderingWarning);
      return;
    }
    if (deadlineWarning) {
      setError(deadlineWarning);
      return;
    }

    const parsedCapacity = Math.max(0, Math.round(Number(seatCapacity) || 0));
    const parsedHeld = Math.max(0, Math.round(Number(seatsHeld) || 0));

    if (isEdit && parsedCapacity < seatsTicketed) {
      setError(
        `Seat capacity cannot be less than ${seatsTicketed} (tickets already issued).`,
      );
      return;
    }
    if (isEdit && parsedHeld < seatsTicketed) {
      setError(
        `Seats held cannot be less than ${seatsTicketed} (tickets already issued).`,
      );
      return;
    }
    if (parsedHeld > parsedCapacity) {
      setError("Seats held cannot exceed seat capacity.");
      return;
    }

    // Chain completeness: if there are any legs at all, the last one MUST
    // land at the flight's destination. Otherwise the itinerary is a broken
    // chain (e.g. flight says CMB→JED but legs stop at DXB) and the whole
    // sector no longer decomposes. Add one more leg from that airport to
    // the destination before saving.
    if (legs.length > 0) {
      const lastDest = legs[legs.length - 1].destinationCode
        .trim()
        .toUpperCase();
      const sectorDest = destinationCode.trim().toUpperCase();
      if (!lastDest) {
        setLegError(
          `Transit stop ${legs.length}: pick where this segment lands.`,
        );
        return;
      }
      if (lastDest !== sectorDest) {
        setLegError(
          `Itinerary ends at ${lastDest} but the flight's destination is ${sectorDest || "—"}. Add another segment from ${lastDest} to ${sectorDest || "the destination"}, or change the sector's destination.`,
        );
        return;
      }
    }

    const unsavedLegs = legs.filter((l) => !l.saved);
    for (let i = 0; i < unsavedLegs.length; i++) {
      const leg = unsavedLegs[i];
      const idx = legs.findIndex((l) => l.key === leg.key);
      if (
        !leg.airline.trim() ||
        !leg.flightNumber.trim() ||
        !leg.destinationCode.trim() ||
        !leg.departureAt ||
        !leg.arrivalAt
      ) {
        setLegError(`Transit stop ${idx + 1} is missing required fields.`);
        return;
      }
    }

    const newLegs = unsavedLegs.map((leg) => {
      const idx = legs.findIndex((l) => l.key === leg.key);
      return {
        airline: leg.airline.trim(),
        flightNumber: leg.flightNumber.trim(),
        originAirportCode: legOrigin(idx),
        destinationAirportCode: leg.destinationCode.trim(),
        departureAt: fromLocalInputValue(leg.departureAt) ?? "",
        arrivalAt: fromLocalInputValue(leg.arrivalAt) ?? "",
      };
    });

    const payload = {
      id: flight?.id,
      departureGroupId,
      direction,
      status,
      airline: airline.trim(),
      flightNumber: flightNumber.trim() || undefined,
      pnr: flight?.pnr ?? undefined,
      bookingReference: flight?.bookingReference ?? undefined,
      originAirportCode: originCode.trim(),
      originAirportName: originName.trim(),
      destinationAirportCode: destinationCode.trim(),
      destinationAirportName: destinationName.trim(),
      departureAt: fromLocalInputValue(departureAt) ?? "",
      arrivalAt: fromLocalInputValue(arrivalAt) ?? "",
      // The naive-local date the operator actually picked — server uses
      // this for the trip-window check to avoid timezone shifts making an
      // Aug 31 flight read as Aug 30 in UTC.
      departureLocalDate: departureAt ? departureAt.slice(0, 10) : undefined,
      arrivalLocalDate: arrivalAt ? arrivalAt.slice(0, 10) : undefined,
      cabinClass: cabinClass.trim(),
      seatCapacity: parsedCapacity,
      seatsHeld: parsedHeld,
      ticketingDeadline: fromLocalInputValue(ticketingDeadline),
      supplierName: supplierName.trim() || undefined,
      supplierId,
      notes: notes.trim() || undefined,
      newLegs: newLegs.length > 0 ? newLegs : undefined,
    };

    const check = upsertFlightSchema.safeParse(payload);
    if (!check.success) {
      const first = check.error.issues[0];
      const msg = first?.message ?? "That flight is not valid.";
      // Route leg-shaped errors to the leg banner so the operator sees them
      // in context.
      if (first?.path?.[0] === "newLegs") {
        setLegError(msg);
      } else {
        setError(msg);
      }
      return;
    }

    startTransition(async () => {
      const result = await upsertGroupFlightAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: isEdit ? "Flight updated" : "Flight added",
        description:
          unsavedLegs.length > 0
            ? `${DIRECTION_LABELS[result.direction]} flight saved with ${unsavedLegs.length} new stop${unsavedLegs.length === 1 ? "" : "s"}.`
            : `${DIRECTION_LABELS[result.direction]} flight saved.`,
      });
      onClose();
    });
  };

  const lastLegLandsAtDestination =
    legs.length === 0 ||
    legs[legs.length - 1].destinationCode.trim().toUpperCase() ===
      destinationCode.trim().toUpperCase();

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="min-w-[calc(100vw-20rem)] gap-0">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit Flight" : "Add Flight"}</SheetTitle>
          <SheetDescription>
            {isEdit && flight
              ? `${DIRECTION_LABELS[flight.direction]} · ${flight.airline}`
              : "Add the outbound or return sector for this group."}
          </SheetDescription>
        </SheetHeader>

        <div className="overflow-y-auto custom-scroll px-5 py-5">
          {noDirectionsLeft ? (
            <p className="text-sm text-muted-foreground">
              Both the outbound and return flights already exist for this group.
              Edit one of them instead.
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {/* ── Sector ─────────────────────────────────────────────── */}
              <section className="flex flex-col gap-3">
                <SectionHeading
                  title="Sector"
                  description="Direction, operating airline, and workflow status."
                />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText>
                        Airline <span className="text-destructive">*</span>
                      </InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={airline}
                      onChange={(e) => setAirline(e.target.value)}
                      placeholder="Sri Lankan Airlines"
                      autoFocus
                    />
                  </InputGroup>
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText>Flight number</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={flightNumber}
                      onChange={(e) => setFlightNumber(e.target.value)}
                      placeholder="UL 213"
                    />
                  </InputGroup>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText>Direction</InputGroupText>
                    </InputGroupAddon>
                    {isEdit ? (
                      <InputGroupInput
                        readOnly
                        disabled
                        value={DIRECTION_LABELS[direction]}
                      />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger className="items-start w-full">
                          <InputGroupInput
                            readOnly
                            value={DIRECTION_LABELS[direction]}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-40">
                          {availableDirections.map((option) => (
                            <DropdownMenuItem
                              key={option}
                              onClick={() => setDirection(option)}
                            >
                              {DIRECTION_LABELS[option]}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </InputGroup>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="w-full">
                      <InputGroup>
                        <InputGroupAddon align="block-start">
                          <InputGroupText>Status</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          readOnly
                          value={STATUS_LABELS[status]}
                        />
                      </InputGroup>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-40">
                      {availableStatuses.map((option) => (
                        <DropdownMenuItem
                          key={option}
                          onClick={() => setStatus(option)}
                        >
                          {STATUS_LABELS[option]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </section>

              {/* ── Route & schedule ───────────────────────────────────── */}
              <section className="flex flex-col gap-3">
                <SectionHeading
                  title="Route & schedule"
                  description="Where the whole sector starts and ends. Break it into stops below."
                />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
                  <Card className="flex flex-col gap-3 p-3">
                    <div className="flex items-center gap-2">
                      <SectionHeading title="Origin" />
                    </div>
                    <ButtonGroup className="w-full">
                      <InputGroup className="flex-1 ">
                        <InputGroupAddon align="block-start">
                          <InputGroupText>
                            Code <span className="text-destructive">*</span>
                          </InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          value={originCode}
                          onChange={(e) =>
                            setOriginCode(e.target.value.toUpperCase())
                          }
                          placeholder="CMB"
                          maxLength={3}
                          className="tabular-nums uppercase rounded-r-none border-r-none!"
                        />
                      </InputGroup>
                      <InputGroup className="flex-6">
                        <InputGroupAddon align="block-start">
                          <InputGroupText>
                            Airport name{" "}
                            <span className="text-destructive">*</span>
                          </InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          value={originName}
                          className="rounded-l-none"
                          onChange={(e) => setOriginName(e.target.value)}
                          placeholder="Bandaranaike International, Colombo"
                        />
                      </InputGroup>
                    </ButtonGroup>
                    <DateTimePicker
                      label="Departure"
                      required
                      value={departureAt}
                      onChange={setDepartureAt}
                    />
                  </Card>

                  <Card className="flex flex-col gap-3 p-3">
                    <div className="flex items-center gap-2">
                      <SectionHeading title="Destination" />
                    </div>
                    <ButtonGroup className="w-full">
                      <InputGroup className="flex-1">
                        <InputGroupAddon align="block-start">
                          <InputGroupText>
                            Code <span className="text-destructive">*</span>
                          </InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          value={destinationCode}
                          onChange={(e) =>
                            setDestinationCode(e.target.value.toUpperCase())
                          }
                          placeholder="JED"
                          maxLength={3}
                          className="tabular-nums uppercase border-r-none rounded-r-none"
                        />
                      </InputGroup>
                      <InputGroup className="flex-6">
                        <InputGroupAddon align="block-start">
                          <InputGroupText>
                            Airport name{" "}
                            <span className="text-destructive">*</span>
                          </InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          value={destinationName}
                          className="rounded-l-none"
                          onChange={(e) => setDestinationName(e.target.value)}
                          placeholder="King Abdulaziz International, Jeddah"
                        />
                      </InputGroup>
                    </ButtonGroup>
                    <DateTimePicker
                      label="Arrival"
                      required
                      value={arrivalAt}
                      onChange={setArrivalAt}
                    />
                  </Card>
                </div>

                {tripWindowWarning && (
                  <div
                    className={`flex items-start gap-2 rounded-sm px-3 py-2 text-xs ${TONE_CLASS.warning}`}
                  >
                    <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                    <span>
                      {tripWindowWarning} Trip runs {groupDepartureDate} →{" "}
                      {groupReturnDate}.
                    </span>
                  </div>
                )}
                {orderingWarning && (
                  <div
                    className={`flex items-start gap-2 rounded-sm px-3 py-2 text-xs ${TONE_CLASS.warning}`}
                  >
                    <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                    <span>{orderingWarning}</span>
                  </div>
                )}
              </section>

              {/* ── Journey Builder ────────────────────────────────────── */}
              <section className="flex flex-col gap-3">
                <SectionHeading
                  title="Journey"
                  description="Direct? Skip this section. For a stop, add ONE segment per flight — a one-stop journey needs two segments (origin → stop, stop → destination)."
                  act={
                    <Button
                      type="button"
                      variant="outline_without_border"
                      onClick={addTransitStop}
                    >
                      <Plus /> Add segment
                    </Button>
                  }
                />

                <Card className=" overflow-hidden mt-2">
                  {/* Journey stats */}
                  <div className="flex flex-wrap items-center gap-x-7 ">
                    <div className="flex items-center gap-1.5">
                      <Plane className="size-3.5 text-muted-foreground" />
                      <span className="text-md text-muted-foreground">
                        Stops
                      </span>
                      <span className="text-m font-medium text-foreground">
                        {journey.stops === 0
                          ? "Direct"
                          : `${journey.stops} stop${journey.stops === 1 ? "" : "s"}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="size-3.5 text-muted-foreground" />
                      <span className="text-md text-muted-foreground">
                        Total
                      </span>
                      <span className="text-md font-medium tabular-nums text-foreground">
                        {journey.totalMinutes === null
                          ? "—"
                          : formatDuration(journey.totalMinutes)}
                      </span>
                    </div>
                    {journey.inAirMinutes !== null && journey.stops > 0 && (
                      <div className="flex items-center gap-1.5">
                        <PlaneTakeoff className="size-3.5 text-muted-foreground" />
                        <span className="text-md text-muted-foreground">
                          In air
                        </span>
                        <span className="text-md font-medium tabular-nums text-foreground">
                          {formatDuration(journey.inAirMinutes)}
                        </span>
                      </div>
                    )}
                    {journey.layoverMinutes !== null && journey.stops > 0 && (
                      <div className="flex items-center gap-1.5">
                        <TimerReset
                          className={`size-3.5 ${TONE_TEXT.warning}`}
                        />
                        <span className="text-md text-muted-foreground">
                          On ground
                        </span>
                        <span className="text-md font-medium tabular-nums text-foreground">
                          {formatDuration(journey.layoverMinutes)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Timeline */}
                  <div className="mt-2">
                    {/* Origin node */}
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col items-center">
                        <div className="size-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 ring-4 ring-primary/10">
                          <PlaneTakeoff className="size-4" />
                        </div>
                        <div
                          className={`w-px flex-1 ${legs.length > 0 || journey.inAirMinutes !== null ? "bg-border" : "bg-transparent"} my-1 min-h-6`}
                        />
                      </div>
                      <div className="flex-1 pb-4">
                        <div className="flex items-baseline gap-2">
                          <span className="text-base font-semibold tabular-nums text-foreground">
                            {originCode.trim().toUpperCase() || "—"}
                          </span>
                          <span className="text-xs text-muted-foreground truncate">
                            {originName || "Origin airport"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                          {departureAt
                            ? `Departs ${format(new Date(departureAt), "EEE, MMM d · HH:mm")}`
                            : "No departure time set"}
                        </p>
                      </div>
                    </div>

                    {/* Direct segment card, when there are no stops */}
                    {legs.length === 0 && (
                      <div className="flex items-start gap-3">
                        <div className="flex flex-col items-center">
                          <div className="w-px flex-1 bg-border" />
                        </div>
                        <div className="flex-1 pb-4 -mt-2">
                          <div className="rounded-md border border-dashed border-border bg-background px-3 py-2.5">
                            <div className="flex items-center gap-2 mb-1">
                              <Plane className="size-3.5 text-muted-foreground" />
                              <span className="text-xs font-medium text-foreground">
                                Direct flight
                              </span>
                              {journey.inAirMinutes !== null && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] tabular-nums ml-auto"
                                >
                                  {formatDuration(journey.inAirMinutes)}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {airline || "Airline"}
                              {flightNumber ? ` · ${flightNumber}` : ""} —
                              non-stop from{" "}
                              {originCode.trim().toUpperCase() || "origin"} to{" "}
                              {destinationCode.trim().toUpperCase() ||
                                "destination"}
                              .
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Leg cards + layovers */}
                    {legs.map((leg, i) => {
                      const layoverBefore =
                        i > 0
                          ? minutesBetween(
                              legs[i - 1].arrivalAt,
                              leg.departureAt,
                            )
                          : null;
                      const legMinutes = minutesBetween(
                        leg.departureAt,
                        leg.arrivalAt,
                      );

                      return (
                        <React.Fragment key={leg.key}>
                          {i > 0 && (
                            <div className="flex items-start gap-3">
                              <div className="flex flex-col items-center">
                                <div className="w-px h-2 bg-border" />
                                <div
                                  className={`size-3 rounded-full ${TONE_BAR.warning} shrink-0`}
                                />
                                <div className="w-px flex-1 bg-border" />
                              </div>
                              <div className="flex-1 py-2 -mt-1">
                                <div
                                  className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs ${TONE_CLASS.warning}`}
                                >
                                  <TimerReset className="size-3" />
                                  <span className="font-medium">
                                    Layover at {legOrigin(i)}
                                  </span>
                                  {layoverBefore !== null && (
                                    <span className="tabular-nums">
                                      · {formatDuration(layoverBefore)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="flex items-start gap-3">
                            <div className="flex flex-col items-center">
                              <div className="size-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0 ring-4 ring-muted/40">
                                <Plane className="size-4" />
                              </div>
                              <div className="w-px flex-1 bg-border my-1 min-h-6" />
                            </div>
                            <div className="flex-1 pb-4">
                              <Card className="p-0 gap-0">
                                <div className="flex items-center justify-between gap-2 px-3 py-2 border-none border-border/60 bg-muted/30">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] tabular-nums text-muted-foreground shrink-0"
                                    >
                                      Leg {i + 1}
                                    </Badge>
                                    <span className="text-lg tabular-nums font-medium text-foreground truncate">
                                      {legOrigin(i)}{" "}
                                      <ArrowRight className="inline size-3 text-muted-foreground align-middle" />{" "}
                                      {leg.destinationCode
                                        .trim()
                                        .toUpperCase() || "?"}
                                    </span>
                                    {legMinutes !== null && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs bg-primary/10 text-primary tabular-nums"
                                      >
                                        {formatDuration(legMinutes)}
                                      </Badge>
                                    )}
                                    {leg.saved && editingLegKey !== leg.key && (
                                      <Badge className="text-xs bg-primary/10 text-primary">
                                        Saved
                                      </Badge>
                                    )}
                                  </div>
                                  {!leg.saved && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      onClick={() => removeTransitStop(leg.key)}
                                      aria-label={`Remove stop ${i + 1}`}
                                    >
                                      <X className="size-3.5" />
                                    </Button>
                                  )}
                                  {leg.saved && editingLegKey !== leg.key && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        disabled={legBusyKey === leg.key}
                                        onClick={() => startEditingLeg(leg)}
                                        aria-label={`Edit stop ${i + 1}`}
                                      >
                                        <Pencil className="size-3.5" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        disabled={legBusyKey === leg.key}
                                        onClick={() => deleteLeg(leg)}
                                        aria-label={`Remove stop ${i + 1}`}
                                      >
                                        {legBusyKey === leg.key ? (
                                          <Loader2 className="size-3.5 animate-spin" />
                                        ) : (
                                          <Trash2 className="size-3.5" />
                                        )}
                                      </Button>
                                    </div>
                                  )}
                                  {leg.saved && editingLegKey === leg.key && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        disabled={isLegPending}
                                        onClick={() => cancelEditingLeg(leg)}
                                        aria-label={`Cancel editing stop ${i + 1}`}
                                      >
                                        <X className="size-3.5" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        disabled={isLegPending}
                                        onClick={() => saveEditedLeg(leg)}
                                        aria-label={`Save stop ${i + 1}`}
                                      >
                                        {legBusyKey === leg.key ? (
                                          <Loader2 className="size-3.5 animate-spin" />
                                        ) : (
                                          <Check className="size-3.5" />
                                        )}
                                      </Button>
                                    </div>
                                  )}
                                </div>

                                <div className="px-3 py-4 flex flex-col gap-2.5">
                                  <div className="grid grid-cols-2 gap-2">
                                    <InputGroup>
                                      <InputGroupAddon align="block-start">
                                        <InputGroupText>
                                          Airline{" "}
                                          <span className="text-destructive">
                                            *
                                          </span>
                                        </InputGroupText>
                                      </InputGroupAddon>
                                      <InputGroupInput
                                        value={leg.airline}
                                        disabled={
                                          leg.saved && editingLegKey !== leg.key
                                        }
                                        onChange={(e) =>
                                          updateLeg(leg.key, {
                                            airline: e.target.value,
                                          })
                                        }
                                        placeholder="Flydubai"
                                      />
                                    </InputGroup>
                                    <InputGroup>
                                      <InputGroupAddon align="block-start">
                                        <InputGroupText>
                                          Flight #{" "}
                                          <span className="text-destructive">
                                            *
                                          </span>
                                        </InputGroupText>
                                      </InputGroupAddon>
                                      <InputGroupInput
                                        value={leg.flightNumber}
                                        disabled={
                                          leg.saved && editingLegKey !== leg.key
                                        }
                                        onChange={(e) =>
                                          updateLeg(leg.key, {
                                            flightNumber: e.target.value,
                                          })
                                        }
                                        placeholder="FZ 872"
                                      />
                                    </InputGroup>
                                  </div>

                                  <InputGroup>
                                    <InputGroupAddon align="block-start">
                                      <InputGroupText>
                                        Lands at (CODE){" "}
                                        <span className="text-destructive">
                                          *
                                        </span>
                                      </InputGroupText>
                                    </InputGroupAddon>
                                    <InputGroupInput
                                      value={leg.destinationCode}
                                      disabled={
                                        leg.saved && editingLegKey !== leg.key
                                      }
                                      onChange={(e) =>
                                        updateLeg(leg.key, {
                                          destinationCode:
                                            e.target.value.toUpperCase(),
                                        })
                                      }
                                      placeholder="DXB"
                                      maxLength={3}
                                      className="tabular-nums uppercase"
                                    />
                                  </InputGroup>

                                  <div className="grid grid-cols-2 gap-2">
                                    <DateTimePicker
                                      label="Departs"
                                      required
                                      value={leg.departureAt}
                                      onChange={(v) =>
                                        updateLeg(leg.key, { departureAt: v })
                                      }
                                      disabled={
                                        leg.saved && editingLegKey !== leg.key
                                      }
                                    />
                                    <DateTimePicker
                                      label="Arrives"
                                      required
                                      value={leg.arrivalAt}
                                      onChange={(v) =>
                                        updateLeg(leg.key, { arrivalAt: v })
                                      }
                                      disabled={
                                        leg.saved && editingLegKey !== leg.key
                                      }
                                    />
                                  </div>
                                </div>
                              </Card>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })}

                    {/* Destination node */}
                    <div className="flex items-start gap-3">
                      <div className="size-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 ring-4 ring-primary/10">
                        <PlaneLanding className="size-4" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-base font-semibold tabular-nums text-foreground">
                            {destinationCode.trim().toUpperCase() || "—"}
                          </span>
                          <span className="text-xs text-muted-foreground truncate">
                            {destinationName || "Destination airport"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                          {arrivalAt
                            ? `Arrives ${format(new Date(arrivalAt), "EEE, MMM d · HH:mm")}`
                            : "No arrival time set"}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>

                {!lastLegLandsAtDestination && (
                  <div
                    className={`flex items-start gap-2 rounded-sm px-3 py-2 text-xs ${TONE_CLASS.warning}`}
                  >
                    <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                    <span>
                      Last stop lands at{" "}
                      <span className="tabular-nums">
                        {legs[legs.length - 1].destinationCode
                          .trim()
                          .toUpperCase() || "—"}
                      </span>
                      , not the final destination{" "}
                      <span className="tabular-nums">
                        {destinationCode.trim().toUpperCase() || "—"}
                      </span>
                      . Add one more stop or update the last one so the chain
                      reaches the destination.
                    </span>
                  </div>
                )}

                {legError && (
                  <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                    <span>{legError}</span>
                  </div>
                )}
              </section>

              {/* ── Inventory & ticketing ─────────────────────────────── */}
              <section className="flex flex-col gap-3">
                <SectionHeading
                  title="Inventory & ticketing"
                  description="Seat capacity, held allocation, and the ticketing deadline."
                />
                <div className="grid grid-cols-3 gap-3 mt-2">
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText>Cabin class</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={cabinClass}
                      onChange={(e) => setCabinClass(e.target.value)}
                      placeholder="Economy"
                    />
                  </InputGroup>
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText>Seat capacity</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      type="number"
                      inputMode="numeric"
                      min={seatsTicketed}
                      placeholder="40"
                      value={seatCapacity}
                      onChange={(e) => setSeatCapacity(e.target.value)}
                      className="tabular-nums"
                    />
                  </InputGroup>
                  <InputGroup>
                    <InputGroupAddon align="block-start">
                      <InputGroupText>Seats held</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      type="number"
                      inputMode="numeric"
                      min={seatsTicketed}
                      value={seatsHeld}
                      onChange={(e) => setSeatsHeld(e.target.value)}
                      className="tabular-nums"
                    />
                  </InputGroup>
                </div>

                {isEdit && seatsTicketed > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {seatsTicketed} ticket
                    {seatsTicketed === 1 ? " has" : "s have"} been issued —
                    capacity and seats held cannot go below this.
                  </p>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <DateTimePicker
                    label="Ticketing deadline"
                    value={ticketingDeadline}
                    onChange={setTicketingDeadline}
                    placeholder="Pick a deadline"
                  />
                  <div className="flex flex-col gap-1.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <InputGroup>
                          <InputGroupAddon align="block-start">
                            <InputGroupText>Supplier</InputGroupText>
                          </InputGroupAddon>
                          <InputGroupInput
                            readOnly
                            value={supplierName || "No supplier assigned"}
                            className={
                              supplierName ? undefined : "text-muted-foreground"
                            }
                          />
                        </InputGroup>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="min-w-56 max-h-64 overflow-y-auto"
                      >
                        {supplierId && (
                          <DropdownMenuItem
                            onClick={() => {
                              setSupplierId(null);
                              setSupplierName("");
                            }}
                            className="text-muted-foreground"
                          >
                            <Link2Off className="size-3.5" /> Clear supplier
                          </DropdownMenuItem>
                        )}
                        {supplierOptions.length === 0 ? (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground max-w-56">
                            No ticketing agents or brokers in your Supplier
                            Directory yet.
                          </div>
                        ) : (
                          supplierOptions.map((s) => (
                            <DropdownMenuItem
                              key={s.id}
                              onClick={() => {
                                setSupplierName(s.name);
                                setSupplierId(s.id);
                              }}
                            >
                              {supplierId === s.id && (
                                <Link2 className="size-3.5" />
                              )}
                              {s.name}
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {supplierOptions.length === 0 && (
                      <a
                        href="/suppliers"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-primary hover:underline"
                      >
                        Add a ticketing agent to your Supplier Directory →
                      </a>
                    )}
                  </div>
                </div>

                {deadlineWarning && (
                  <div
                    className={`flex items-start gap-2 rounded-sm px-3 py-2 text-xs ${TONE_CLASS.warning}`}
                  >
                    <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                    <span>{deadlineWarning}</span>
                  </div>
                )}
              </section>

              {/* ── Notes ─────────────────────────────────────────────── */}
              <section className="flex flex-col gap-3">
                <SectionHeader title="Notes" subtitle="Optional." />
                <InputGroup className="overflow-hidden">
                  <InputGroupAddon align="block-start">
                    <InputGroupText>Internal notes</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupTextarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Awaiting ministry quota confirmation…"
                    rows={2}
                    className="max-h-24 overflow-y-auto"
                  />
                </InputGroup>
              </section>

              {error && (
                <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <SheetFooter className="flex flex-row gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!noDirectionsLeft && (
            <Button disabled={isPending} onClick={submit}>
              {isPending && <Loader2 className="animate-spin" />}
              {isEdit ? "Save changes" : "Add flight"}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default AddEditFlightSheet;
