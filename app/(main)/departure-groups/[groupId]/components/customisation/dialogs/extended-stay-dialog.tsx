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
import { DatePicker } from "@/components/date-time-picker";
import { InputGroupInput } from "@/components/ui/input-group";

interface ExtendedStayDialogProps {
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

const ExtendedStayDialog = ({
  row,
  departureGroupId,
  flights,
  open,
  onClose,
  embedded = false,
}: ExtendedStayDialogProps) => {
  const [flightId, setFlightId] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [arrangement, setArrangement] = useState("");

  const common = useDeviationCommonFields({
    blocksDeparture: true,
    addCharge: true,
  });

  useResetOnOpen(open, row?.id ?? "", () => {
    setFlightId("");
    setReturnDate("");
    setArrangement("");
    common.reset();
  });

  const detail =
    returnDate && arrangement.trim()
      ? {
          kind: "EXTENDED_STAY" as const,
          returnFlightId: flightId || null,
          newReturnDate: returnDate,
          onwardArrangement: arrangement.trim(),
        }
      : null;

  const autoSummary = detail
    ? `Extended stay — returns ${detail.newReturnDate}`
    : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "EXTENDED_STAY",
    suggestedChargeType: "FLIGHT_VARIATION",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        {flights.length > 0 && (
          <SelectMenu
            value={flightId}
            onChange={(e) => setFlightId(e)}
            options={flights
              .filter((f) => f.direction === "RETURN")
              .map((f) => {
                return {
                  label: flightLabel(f),
                  value: f.id,
                };
              })}
            label="Link to return flight"
          />
        )}
        <DatePicker
          placeholder="Return Date"
          value={returnDate}
          onChange={(e) => setReturnDate(e)}
          label=""
        />

        <InputGroupInput
          placeholder="How does the traveller return? E.g. own ticket"
          value={arrangement}
          onChange={(e) => setArrangement(e.target.value)}
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
          <DialogTitle>Extended Stay</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default ExtendedStayDialog;
