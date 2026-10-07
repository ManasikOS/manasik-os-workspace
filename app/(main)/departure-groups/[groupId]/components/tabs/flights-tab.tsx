"use client";

import SectionHeading from "@/components/section-heading";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/data-table/data-table";
import { Separator } from "@/components/ui/separator";
import { type StaffRole } from "@/lib/access/departure-groups-access";
import {
  AlertTriangle,
  ArrowRight,
  Compass,
  Download,
  MoreVertical,
  PlaneLanding,
  PlaneTakeoff,
  Plus,
  TicketCheck,
  Upload,
  UserMinus,
} from "lucide-react";
import React, { useMemo, useState } from "react";

import {
  EmptyState,
  FlightStatusBadge,
  ProgressBar,
} from "../../../components/status-badges";
import { downloadTextFile, timestampedFilename, toCsv } from "../../../csv";
import type {
  DepartureGroupFlight,
  DepartureGroupManifestRow,
  FlightDirection,
  PilgrimDeviation,
} from "../../../types";
import {
  deviationTone,
  formatDate,
  formatDateTime,
  formatTime,
} from "../../../utils";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";
import AddEditFlightDialog from "../add-edit-flight-dialog";
import BulkUploadTicketsDialog from "../bulk-upload-tickets-dialog";
import FlightItineraryDialog from "../flight-itinerary-dialog";
import FlightTicketingDialog from "../flight-ticketing-dialog";
import MarkTicketsIssuedDialog from "../mark-tickets-issued-dialog";
import { buildFlightTicketingColumns } from "./flight-ticketing-columns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FlightsTabProps {
  groupId: string;
  /** ISO date (YYYY-MM-DD) — the trip's start day. */
  groupDepartureDate: string;
  /** ISO date (YYYY-MM-DD) — the trip's end day. */
  groupReturnDate: string;
  flights: DepartureGroupFlight[];
  manifest: DepartureGroupManifestRow[];
  role: StaffRole;
}

function FlightDetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-sm text-foreground ${mono ? "tabular-nums" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function FlightCard({
  flight,
  canManage,
  onEdit,
  onViewItinerary,
}: {
  flight: DepartureGroupFlight;
  canManage: boolean;
  onEdit: (flight: DepartureGroupFlight) => void;
  onViewItinerary: (flight: DepartureGroupFlight) => void;
}) {
  const outbound = flight.direction === "OUTBOUND";
  const Icon = outbound ? PlaneTakeoff : PlaneLanding;

  return (
    <Card className="gap-4">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="size-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {outbound ? "Outbound Flight" : "Return Flight"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {flight.airline}
              {flight.flightNumber ? ` · ${flight.flightNumber}` : ""}
            </p>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <FlightStatusBadge value={flight.status} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onViewItinerary(flight)}
          >
            <Compass /> Itinerary
          </Button>
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => onEdit(flight)}>
              Edit Flight
            </Button>
          )}
        </div>
      </div>

      {/* Route line */}
      <Card
        variant="md-shadow"
        className="grid  items-center grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 rounded-sm bg-muted/50 px-3 py-3 sm:gap-4"
      >
        <div className="flex min-w-0 flex-col">
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {flight.originAirportCode}
          </span>
          <span className="text-xs text-muted-foreground max-w-40 truncate">
            {flight.originAirportName}
          </span>
          <span className="text-xs text-foreground mt-1 tabular-nums">
            {formatDateTime(flight.departureAt)}
          </span>
        </div>
        <ArrowRight className="size-4 text-muted-foreground" />
        <div className="flex min-w-0 flex-col text-right">
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {flight.destinationAirportCode}
          </span>
          <span className="text-[11px] text-muted-foreground max-w-40 truncate">
            {flight.destinationAirportName}
          </span>
          <span className="text-xs text-foreground mt-1 tabular-nums">
            {formatDateTime(flight.arrivalAt)}
          </span>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FlightDetailField
          label="PNR"
          value={flight.pnr ?? "Not issued"}
          mono
        />
        <FlightDetailField
          label="Booking reference"
          value={flight.bookingReference ?? "—"}
          mono
        />
        <FlightDetailField label="Cabin class" value={flight.cabinClass} />
        <FlightDetailField
          label="Supplier / agent"
          value={flight.supplierName ?? "—"}
        />
        <FlightDetailField label="Seats held" value={flight.seatsHeld} mono />
        <FlightDetailField
          label="Tickets issued"
          value={`${flight.seatsTicketed} / ${flight.seatCapacity}`}
          mono
        />
        <FlightDetailField
          label="Ticketing deadline"
          value={formatDate(flight.ticketingDeadline)}
        />
        <FlightDetailField
          label="Seat capacity"
          value={flight.seatCapacity}
          mono
        />
      </div>

      {flight.notes && (
        <p className={cn("text-xs rounded-sm px-3 py-2", TONE_CLASS.warning)}>
          {flight.notes}
        </p>
      )}

      {/* Transit legs */}
      {flight.legs.length > 0 && (
        <>
          {/* <Separator /> */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
              <h3 className="text-sm font-medium text-foreground">
                Transit legs
              </h3>
              {canManage && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onEdit(flight)}
                >
                  <Plus /> Add Stop
                </Button>
              )}
            </div>
            {flight.legs
              .slice()
              .sort((a, b) => a.legOrder - b.legOrder)
              .map((leg) => (
                <Card
                  key={leg.id}
                  className="flex flex-col items-stretch justify-between gap-3 rounded-sm px-4 py-4 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                    <Badge
                      variant="outline"
                      className="text-[10px] tabular-nums text-muted-foreground"
                    >
                      Leg {leg.legOrder}
                    </Badge>
                    <span className="text-sm text-foreground tabular-nums">
                      {leg.originAirportCode} → {leg.destinationAirportCode}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {leg.airline} {leg.flightNumber}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] tabular-nums text-muted-foreground sm:justify-end">
                    <span>
                      {formatTime(leg.departureAt)} →{" "}
                      {formatTime(leg.arrivalAt)}
                    </span>
                    {leg.transitDurationMinutes !== null && (
                      <span>
                        Transit {Math.floor(leg.transitDurationMinutes / 60)}h{" "}
                        {leg.transitDurationMinutes % 60}m
                      </span>
                    )}
                  </div>
                </Card>
              ))}
          </div>
        </>
      )}
      {flight.legs.length === 0 && canManage && (
        <>
          <Separator />
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <p className="text-xs text-muted-foreground">
              Direct flight — no transit legs.
            </p>
            <Button variant="ghost" size="xs" onClick={() => onEdit(flight)}>
              <Plus /> Add Stop
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/** Client-side CSV export of the flight summary and per-pilgrim ticketing. */
function exportFlightManifest(
  flights: DepartureGroupFlight[],
  manifest: DepartureGroupManifestRow[],
): void {
  const rows: string[][] = [
    [
      "Direction",
      "Airline",
      "Flight Number",
      "Route",
      "Status",
      "PNR",
      "Seats Held",
      "Seats Ticketed",
    ],
    ...flights.map((f) => [
      f.direction === "OUTBOUND" ? "Outbound" : "Return",
      f.airline,
      f.flightNumber ?? "—",
      `${f.originAirportCode} -> ${f.destinationAirportCode}`,
      f.status,
      f.pnr ?? "—",
      String(f.seatsHeld),
      String(f.seatsTicketed),
    ]),
    [],
    [
      "Pilgrim",
      "Passport",
      "Booking Reference",
      "Seat Status",
      "Flight Status",
    ],
    ...manifest.map((row) => [
      row.fullName,
      row.passportNumber ?? "Restricted",
      row.bookingReference,
      row.seatStatus,
      row.flightStatus,
    ]),
  ];

  downloadTextFile(timestampedFilename("flight-manifest"), toCsv(rows));
}

const FlightsTab = ({
  groupId,
  groupDepartureDate,
  groupReturnDate,
  flights,
  manifest,
  role,
}: FlightsTabProps) => {
  const can = useDepartureCapabilities(role);
  const outbound = flights.find((flight) => flight.direction === "OUTBOUND");
  const ticketed = manifest.filter((row) => row.flightStatus === "TICKETED");
  const withDocument = manifest.filter((row) => !!row.ticketFilePath);
  const exceptions = manifest.filter(
    (row) =>
      row.flightStatus !== "TICKETED" && row.flightStatus !== "CANCELLED",
  );

  const ticketedPercent =
    manifest.length === 0
      ? 0
      : Math.round((ticketed.length / manifest.length) * 100);

  const existingDirections = flights.map(
    (f) => f.direction,
  ) as FlightDirection[];
  const availableDirections = (
    ["OUTBOUND", "RETURN"] as FlightDirection[]
  ).filter((d) => !existingDirections.includes(d));

  const [flightDialog, setFlightDialog] = useState<
    { mode: "add" } | { mode: "edit"; flight: DepartureGroupFlight } | null
  >(null);
  const [itineraryFlight, setItineraryFlight] =
    useState<DepartureGroupFlight | null>(null);
  const [ticketingOpen, setTicketingOpen] = useState(false);
  const [markIssuedOpen, setMarkIssuedOpen] = useState(false);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [ticketSearch, setTicketSearch] = useState("");
  const ticketingRows = useMemo(() => {
    const ordered = [...exceptions, ...ticketed];
    const needle = ticketSearch.trim().toLowerCase();
    if (!needle) return ordered;
    return ordered.filter((pilgrim) =>
      [
        pilgrim.fullName,
        pilgrim.passportNumber ?? "",
        pilgrim.bookingReference,
        pilgrim.seatStatus,
        pilgrim.flightStatus,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [exceptions, ticketSearch, ticketed]);
  const ticketingColumns = buildFlightTicketingColumns({
    departureGroupId: groupId,
    canManage: can.manageFlights,
  });

  return (
    <div className="flex flex-col gap-5">
      <AddEditFlightDialog
        flight={flightDialog?.mode === "edit" ? flightDialog.flight : null}
        departureGroupId={groupId}
        existingDirections={existingDirections}
        groupDepartureDate={groupDepartureDate}
        groupReturnDate={groupReturnDate}
        otherDirectionFlight={
          flightDialog?.mode === "edit"
            ? (flights.find(
                (f) =>
                  f.direction !== flightDialog.flight.direction &&
                  f.status !== "CANCELLED",
              ) ?? null)
            : (flights.find((f) => f.status !== "CANCELLED") ?? null)
        }
        open={flightDialog !== null}
        onClose={() => setFlightDialog(null)}
      />
      <FlightItineraryDialog
        flight={itineraryFlight}
        open={itineraryFlight !== null}
        onClose={() => setItineraryFlight(null)}
      />
      <FlightTicketingDialog
        flights={flights}
        departureGroupId={groupId}
        open={ticketingOpen}
        onClose={() => setTicketingOpen(false)}
      />
      <MarkTicketsIssuedDialog
        flights={flights}
        manifest={manifest}
        departureGroupId={groupId}
        open={markIssuedOpen}
        onClose={() => setMarkIssuedOpen(false)}
      />
      <BulkUploadTicketsDialog
        departureGroupId={groupId}
        open={bulkUploadOpen}
        onClose={() => setBulkUploadOpen(false)}
      />

      {/* Top summary */}
      <Card className="gap-4">
        <SectionHeading
          title="Flight status"
          act={
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              {can.manageFlights && (
                <Button
                  variant="secondary"
                  disabled={availableDirections.length === 0}
                  onClick={() => setFlightDialog({ mode: "add" })}
                >
                  <Plus /> Add Flight
                </Button>
              )}

              {can.manageFlights && can.exportReports && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant={"outline_without_border"}>
                        <MoreVertical />
                      </Button>
                    }
                  />
                  <DropdownMenuContent>
                    {can.manageFlights && (
                      <DropdownMenuItem
                        disabled={flights.length === 0}
                        onClick={() => setTicketingOpen(true)}
                      >
                        <Upload /> Upload Ticket / PNR
                      </DropdownMenuItem>
                    )}
                    {can.manageFlights && (
                      <DropdownMenuItem
                        disabled={flights.length === 0}
                        onClick={() => setMarkIssuedOpen(true)}
                      >
                        <TicketCheck /> Mark Tickets Issued
                      </DropdownMenuItem>
                    )}
                    {can.exportReports && (
                      <DropdownMenuItem
                        onClick={() => exportFlightManifest(flights, manifest)}
                      >
                        <Download /> Export Flight Manifest
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          }
        />

        {outbound ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            <FlightDetailField
              label="Flight status"
              value={<FlightStatusBadge value={outbound.status} />}
            />
            <FlightDetailField
              label="Seats held"
              value={outbound.seatsHeld}
              mono
            />
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">
                Tickets issued
              </span>
              <span className="text-sm text-foreground tabular-nums">
                {ticketed.length} / {manifest.length}
              </span>
              <ProgressBar percent={ticketedPercent} />
            </div>
            <FlightDetailField
              label="Ticket documents on file"
              value={`${withDocument.length} / ${manifest.length}`}
              mono
            />
            <FlightDetailField
              label="Ticketing deadline"
              value={formatDate(outbound.ticketingDeadline)}
            />
            <FlightDetailField
              label="Supplier / agent"
              value={outbound.supplierName ?? "—"}
            />
            <FlightDetailField
              label="PNR"
              value={outbound.pnr ?? "Not issued"}
              mono
            />
          </div>
        ) : (
          <EmptyState
            title="No flights recorded"
            description="Add the outbound and return sectors to start tracking seats and ticketing."
          />
        )}
      </Card>

      {flights.map((flight) => (
        <FlightCard
          key={flight.id}
          flight={flight}
          canManage={can.manageFlights}
          onEdit={(f) => setFlightDialog({ mode: "edit", flight: f })}
          onViewItinerary={setItineraryFlight}
        />
      ))}

      {/* Flight deviations — travellers with non-standard flight arrangements */}
      {(() => {
        const FLIGHT_DEV_TYPES = new Set([
          "OWN_FLIGHT",
          "LAND_ONLY",
          "CABIN_UPGRADE",
          "SEAT_PREFERENCE",
          "EXTENDED_STAY",
        ]);
        const flightDevs: {
          pilgrimName: string;
          deviation: PilgrimDeviation;
        }[] = [];
        for (const row of manifest) {
          for (const d of row.deviations) {
            if (
              FLIGHT_DEV_TYPES.has(d.deviationType) &&
              d.status !== "DECLINED" &&
              d.status !== "CANCELLED"
            ) {
              flightDevs.push({ pilgrimName: row.fullName, deviation: d });
            }
          }
        }

        if (flightDevs.length === 0) return null;

        const excludedCount = manifest.filter((r) =>
          r.deviations.some(
            (d) =>
              ((d.deviationType === "OWN_FLIGHT" ||
                d.deviationType === "LAND_ONLY") &&
                d.status === "APPROVED") ||
              d.status === "ARRANGED",
          ),
        ).length;

        return (
          <Card className="gap-4">
            <SectionHeading
              title="Flight deviations"
              act={
                <div className="flex w-full flex-wrap items-center gap-3 text-xs text-muted-foreground sm:w-auto sm:justify-end">
                  {excludedCount > 0 && (
                    <span className="flex items-center gap-1">
                      <UserMinus className="size-3.5" />
                      {excludedCount} traveller
                      {excludedCount === 1 ? "" : "s"} off group flight
                    </span>
                  )}
                  <span>
                    {flightDevs.length} deviation
                    {flightDevs.length === 1 ? "" : "s"}
                  </span>
                </div>
              }
            />
            <div className="flex flex-col divide-y divide-border/20">
              {flightDevs.map(({ pilgrimName, deviation }) => (
                <div
                  key={deviation.id}
                  className="flex flex-col items-start justify-between gap-2 py-2.5 sm:flex-row sm:gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{pilgrimName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {deviation.deviationType.replace(/_/g, " ")} —{" "}
                      {deviation.summary}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 sm:justify-end">
                    {deviation.blocksDeparture && (
                      <AlertTriangle
                        className={cn("size-3.5", TONE_TEXT.warning)}
                      />
                    )}
                    <Badge
                      className={cn(
                        "text-[10px]",
                        TONE_CLASS[deviationTone(deviation.status)],
                      )}
                    >
                      {deviation.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}

      {/* Per-pilgrim flight state */}
      <Card className="gap-4 overflow-hidden px-0 pb-0 *:data-[slot=card]:rounded-none *:data-[slot=card]:border-x-0 *:data-[slot=card]:border-b-0 *:data-[slot=card]:shadow-none">
        <div className="px-6">
          <SectionHeading
            title="Per-pilgrim ticketing"
            act={
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                {can.manageFlights && (
                  <Button
                    variant="outline_without_border"
                    size="sm"
                    onClick={() => setBulkUploadOpen(true)}
                  >
                    <Upload /> Upload Tickets
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  {exceptions.length === 0
                    ? "No exceptions"
                    : `${exceptions.length} needing attention`}
                </span>
              </div>
            }
          />
        </div>
        <DataTable
          columns={ticketingColumns}
          data={ticketingRows}
          search={ticketSearch}
          onSearchChange={setTicketSearch}
          searchPlaceholder="Search pilgrim, passport, booking, or ticket status..."
          emptyMessage={
            manifest.length === 0
              ? "No pilgrims to ticket yet."
              : "No pilgrims match this search."
          }
          getRowId={(pilgrim) => pilgrim.id}
        />
      </Card>
    </div>
  );
};

export default FlightsTab;
