"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plane, PlaneLanding, PlaneTakeoff } from "lucide-react";
import React from "react";

import { FlightStatusBadge } from "../../components/status-badges";
import type { DepartureGroupFlight } from "../../types";
import { formatDate, formatTime } from "../../utils";
import { TONE_CLASS } from "@/lib/ui/tone";

interface FlightItineraryDialogProps {
  flight: DepartureGroupFlight | null;
  open: boolean;
  onClose: () => void;
}

interface Segment {
  airline: string;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  departureAt: string;
  arrivalAt: string;
}

function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000),
  );
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Full itinerary breakdown for one flight sector — every segment, the layover
 * between each, and the total door-to-door duration. Works the same way for
 * the outbound and return flight: a flight with no transit legs renders as a
 * single direct segment, and one with legs renders the full chain, since the
 * legs then fully decompose the sector (their first origin and last
 * destination match the flight's own).
 */
const FlightItineraryDialog = ({
  flight,
  open,
  onClose,
}: FlightItineraryDialogProps) => {
  const legs = flight
    ? [...flight.legs].sort((a, b) => a.legOrder - b.legOrder)
    : [];

  const segments: Segment[] = !flight
    ? []
    : legs.length > 0
      ? legs.map((leg) => ({
          airline: leg.airline,
          flightNumber: leg.flightNumber,
          originCode: leg.originAirportCode,
          destinationCode: leg.destinationAirportCode,
          departureAt: leg.departureAt,
          arrivalAt: leg.arrivalAt,
        }))
      : [
          {
            airline: flight.airline,
            flightNumber: flight.flightNumber ?? "—",
            originCode: flight.originAirportCode,
            destinationCode: flight.destinationAirportCode,
            departureAt: flight.departureAt,
            arrivalAt: flight.arrivalAt,
          },
        ];

  const stops = Math.max(segments.length - 1, 0);
  const totalMinutes =
    segments.length > 0
      ? minutesBetween(
          segments[0].departureAt,
          segments[segments.length - 1].arrivalAt,
        )
      : 0;
  const DirectionIcon =
    flight?.direction === "OUTBOUND" ? PlaneTakeoff : PlaneLanding;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl! max-h-[85vh] overflow-y-auto custom-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DirectionIcon className="size-4 text-primary" />
            {flight?.direction === "OUTBOUND" ? "Outbound" : "Return"} Itinerary
          </DialogTitle>
          <DialogDescription>
            {flight?.originAirportCode} → {flight?.destinationAirportCode} ·{" "}
            {segments[0] && formatDate(segments[0].departureAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-4 rounded-sm bg-muted/40 px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-[11px] text-muted-foreground">
              Total duration
            </span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {formatDuration(totalMinutes)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] text-muted-foreground">Stops</span>
            <span className="text-sm font-semibold text-foreground">
              {stops === 0
                ? "Direct"
                : `${stops} stop${stops === 1 ? "" : "s"}`}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] text-muted-foreground">Status</span>
            {flight && <FlightStatusBadge value={flight.status} />}
          </div>
        </div>

        <div className="flex flex-col">
          {segments.map((segment, i) => {
            const isLast = i === segments.length - 1;
            const nextSegment = segments[i + 1];
            const segmentMinutes = minutesBetween(
              segment.departureAt,
              segment.arrivalAt,
            );

            return (
              <div
                key={`${segment.flightNumber}-${i}`}
                className="flex flex-col"
              >
                <div className="flex gap-3">
                  <div className="flex flex-col items-center pt-1">
                    <div className="size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Plane className="size-3.5" />
                    </div>
                    {!isLast && (
                      <div className="w-px flex-1 bg-border/60 my-1 min-h-8" />
                    )}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground tabular-nums">
                        {segment.originCode} → {segment.destinationCode}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDuration(segmentMinutes)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {segment.airline} {segment.flightNumber}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-foreground tabular-nums">
                      <span>
                        Dep {formatTime(segment.departureAt)} ·{" "}
                        {formatDate(segment.departureAt)}
                      </span>
                      <span>
                        Arr {formatTime(segment.arrivalAt)} ·{" "}
                        {formatDate(segment.arrivalAt)}
                      </span>
                    </div>
                  </div>
                </div>

                {!isLast && nextSegment && (
                  <div className="flex gap-3">
                    <div className="w-7 flex justify-center">
                      <div className="w-px h-full bg-border/60" />
                    </div>
                    <div className="flex-1 pb-4 -mt-2">
                      <span
                        className={`text-[11px] rounded-sm px-2 py-1 inline-block ${TONE_CLASS.warning}`}
                      >
                        Layover at {segment.destinationCode} ·{" "}
                        {formatDuration(
                          minutesBetween(
                            segment.arrivalAt,
                            nextSegment.departureAt,
                          ),
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FlightItineraryDialog;
