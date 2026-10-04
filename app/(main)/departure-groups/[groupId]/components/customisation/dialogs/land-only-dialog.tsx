"use client";

import { Checkbox } from "@/components/ui/checkbox";
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
import { InputGroupInput } from "@/components/ui/input-group";

interface LandOnlyDialogProps {
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

const LandOnlyDialog = ({
  row,
  departureGroupId,
  flights,
  open,
  onClose,
  embedded = false,
}: LandOnlyDialogProps) => {
  const [flightIds, setFlightIds] = useState<string[]>([]);
  const [note, setNote] = useState("");

  const common = useDeviationCommonFields({
    blocksDeparture: true,
    addCharge: true,
  });

  useResetOnOpen(open, row?.id ?? "", () => {
    setFlightIds([]);
    setNote("");
    common.reset();
  });

  const detail = {
    kind: "LAND_ONLY" as const,
    replacesFlightIds: flightIds,
    ...(note ? { note } : {}),
  };

  const autoSummary = `Land only — no group flight${detail.note ? `: ${detail.note}` : ""}`;

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "LAND_ONLY",
    suggestedChargeType: "FLIGHT_VARIATION",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        {flights.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">
              Which group flight(s) does this replace?
            </p>
            {flights.map((f) => (
              <label key={f.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={flightIds.includes(f.id)}
                  onCheckedChange={(checked) =>
                    setFlightIds((prev) =>
                      checked
                        ? [...prev, f.id]
                        : prev.filter((id) => id !== f.id),
                    )
                  }
                />
                {flightLabel(f)}
              </label>
            ))}
          </div>
        )}
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
        disabled={isPending}
        isPending={isPending}
      />
    </>
  );

  if (embedded) return body;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md! flex! max-h-[85vh] flex-col! overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Land Only</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default LandOnlyDialog;
