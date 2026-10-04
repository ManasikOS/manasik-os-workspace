"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import React, { useState } from "react";

import type {
  DepartureGroupFlight,
  DepartureGroupManifestRow,
} from "../../../../types";
import {
  DeviationCommonFields,
  DeviationFormFooter,
  deviationFieldsCls,
  useDeviationCommonFields,
  useDeviationSubmit,
} from "./common";
import { SelectMenu } from "@/app/(main)/departure-groups/components/add-booking-sheet";
import { InputGroupInput } from "@/components/ui/input-group";

interface SeatPreferenceDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  flights: DepartureGroupFlight[];
  open: boolean;
  onClose: () => void;
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const flightLabel = (f: DepartureGroupFlight) =>
  `${f.airline}${f.flightNumber ? ` ${f.flightNumber}` : ""} · ${f.originAirportCode}→${f.destinationAirportCode} · ${f.direction.toLowerCase()}`;

const PREFERENCES = [
  "WINDOW",
  "AISLE",
  "EXTRA_LEGROOM",
  "BULKHEAD",
  "TOGETHER",
  "OTHER",
] as const;

const SeatPreferenceDialog = ({
  row,
  departureGroupId,
  flights,
  open,
  onClose,
  embedded = false,
}: SeatPreferenceDialogProps) => {
  const [flightId, setFlightId] = useState("");
  const [preference, setPreference] =
    useState<(typeof PREFERENCES)[number]>("WINDOW");
  const [note, setNote] = useState("");

  const common = useDeviationCommonFields({ blocksDeparture: false });

  useResetOnOpen(open, row?.id ?? "", () => {
    setFlightId("");
    setPreference("WINDOW");
    setNote("");
    common.reset();
  });

  const detail = flightId
    ? {
        kind: "SEAT_PREFERENCE" as const,
        flightId,
        preference,
        ...(note ? { note } : {}),
      }
    : null;

  const autoSummary = detail
    ? `Seat preference: ${detail.preference.replace(/_/g, " ").toLowerCase()}${
        detail.note ? ` — ${detail.note}` : ""
      }`
    : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "SEAT_PREFERENCE",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        {flights.length > 0 && (
          <SelectMenu
            label="Flight"
            value={flightId}
            onChange={(e) => setFlightId(e)}
            options={flights.map((f) => {
              return {
                label: flightLabel(f),
                value: f.id,
              };
            })}
          />
        )}

        <SelectMenu
          value={preference}
          label="Seat preference"
          onChange={(e) => setPreference(e as (typeof PREFERENCES)[number])}
          options={PREFERENCES.map((p) => {
            return {
              label: p.replace(/_/g, " ").toLowerCase(),
              value: p,
            };
          })}
        />

        <InputGroupInput
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <DeviationCommonFields common={common} autoSummary={autoSummary} />
      </div>

      <DeviationFormFooter
        embedded={embedded}
        onClose={onClose}
        onSubmit={() => submit(detail, common, autoSummary)}
        disabled={!detail || isPending}
        isPending={isPending}
      />
    </>
  );

  if (embedded) return body;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md! flex! max-h-[85vh] flex-col! overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Seat Preference</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default SeatPreferenceDialog;
