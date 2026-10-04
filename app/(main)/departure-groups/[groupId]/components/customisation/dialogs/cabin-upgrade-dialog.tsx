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
  deviationGrid2Cls,
  useDeviationCommonFields,
  useDeviationSubmit,
} from "./common";
import { SelectMenu } from "@/app/(main)/departure-groups/components/add-booking-sheet";
import { InputGroupInput } from "@/components/ui/input-group";

interface CabinUpgradeDialogProps {
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

const CabinUpgradeDialog = ({
  row,
  departureGroupId,
  flights,
  open,
  onClose,
  embedded = false,
}: CabinUpgradeDialogProps) => {
  const [flightId, setFlightId] = useState("");
  const [pnr, setPnr] = useState("");
  const [fromCabin, setFromCabin] = useState("");
  const [toCabin, setToCabin] = useState("");

  const common = useDeviationCommonFields({
    blocksDeparture: false,
    addCharge: true,
  });

  useResetOnOpen(open, row?.id ?? "", () => {
    setFlightId("");
    setPnr("");
    setFromCabin("");
    setToCabin("");
    common.reset();
  });

  const detail =
    flightId && fromCabin.trim() && toCabin.trim()
      ? {
          kind: "CABIN_UPGRADE" as const,
          flightId,
          fromCabin: fromCabin.trim(),
          toCabin: toCabin.trim(),
          ...(pnr ? { pnr } : {}),
        }
      : null;

  const autoSummary = detail
    ? `Cabin upgrade: ${detail.fromCabin} → ${detail.toCabin}`
    : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "CABIN_UPGRADE",
    suggestedChargeType: "FLIGHT_VARIATION",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        {flights.length > 0 && (
          <SelectMenu
            label="Flight"
            onChange={(e) => setFlightId(e)}
            options={flights.map((f) => ({
              label: flightLabel(f),
              value: f.id,
            }))}
            value={flightId}
          />
        )}

        <div className={deviationGrid2Cls}>
          <SelectMenu
            value={fromCabin}
            onChange={(e) => setFromCabin(e)}
            options={[
              { label: "Economy", value: "ECONOMY" },
              { label: "Business", value: "BUSINESS" },
              { label: "First", value: "FIRST" },
            ]}
            label="From cabin class"
          />
          <SelectMenu
            value={toCabin}
            onChange={(e) => setToCabin(e)}
            options={[
              { label: "Economy", value: "ECONOMY" },
              { label: "Business", value: "BUSINESS" },
              { label: "First", value: "FIRST" },
            ]}
            label="To cabin class"
          />
        </div>
        <InputGroupInput
          placeholder="PNR (optional)"
          value={pnr}
          onChange={(e) => setPnr(e.target.value)}
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
          <DialogTitle>Cabin Upgrade</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default CabinUpgradeDialog;
