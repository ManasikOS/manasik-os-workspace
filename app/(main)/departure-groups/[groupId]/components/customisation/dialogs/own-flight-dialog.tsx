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
  deviationGrid2Cls,
  useDeviationCommonFields,
  useDeviationSubmit,
} from "./common";
import { SelectMenu } from "@/app/(main)/departure-groups/components/add-booking-sheet";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { DateTimePicker } from "@/components/date-time-picker";

interface OwnFlightDialogProps {
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

const OwnFlightDialog = ({
  row,
  departureGroupId,
  flights,
  open,
  onClose,
  embedded = false,
}: OwnFlightDialogProps) => {
  const [flightIds, setFlightIds] = useState<string[]>([]);
  const [direction, setDirection] = useState("OUTBOUND");
  const [airline, setAirline] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [pnr, setPnr] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departureAt, setDepartureAt] = useState("");
  const [arrivalAt, setArrivalAt] = useState("");
  const [arrivesWithGroup, setArrivesWithGroup] = useState(true);

  const common = useDeviationCommonFields({
    blocksDeparture: true,
    addCharge: true,
  });

  useResetOnOpen(open, row?.id ?? "", () => {
    setFlightIds([]);
    setDirection("OUTBOUND");
    setAirline("");
    setFlightNumber("");
    setPnr("");
    setOrigin("");
    setDestination("");
    setDepartureAt("");
    setArrivalAt("");
    setArrivesWithGroup(true);
    common.reset();
  });

  const detail = airline.trim()
    ? {
        kind: "OWN_FLIGHT" as const,
        replacesFlightIds: flightIds,
        direction: direction as "OUTBOUND" | "RETURN" | "BOTH",
        airline: airline.trim(),
        ...(flightNumber ? { flightNumber } : {}),
        ...(pnr ? { pnr } : {}),
        ...(origin ? { originAirportCode: origin } : {}),
        ...(destination ? { destinationAirportCode: destination } : {}),
        ...(departureAt ? { departureAt } : {}),
        ...(arrivalAt ? { arrivalAt } : {}),
        arrivesWithGroup,
      }
    : null;

  const autoSummary = detail
    ? `Own flight (${detail.direction.toLowerCase()}): ${detail.airline}${
        detail.flightNumber ? ` ${detail.flightNumber}` : ""
      }`
    : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "OWN_FLIGHT",
    suggestedChargeType: "FLIGHT_VARIATION",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        <SelectMenu
          value={direction}
          onChange={(e) => setDirection(e)}
          options={[
            { label: "Outbound", value: "OUTBOUND" },
            { label: "Return", value: "RETURN" },
            { label: "Both", value: "BOTH" },
          ]}
          label="Direction"
        />
        {flights.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">
              Replaces which group flight(s)?
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
        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText>Airline</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Enter new airline"
            value={airline}
            onChange={(e) => setAirline(e.target.value)}
          />
        </InputGroup>
        <div className={deviationGrid2Cls}>
          <InputGroupInput
            placeholder="Flight number"
            value={flightNumber}
            onChange={(e) => setFlightNumber(e.target.value)}
          />
          <InputGroupInput
            placeholder="PNR"
            value={pnr}
            onChange={(e) => setPnr(e.target.value)}
          />
        </div>
        <div className={deviationGrid2Cls}>
          <InputGroupInput
            placeholder="Origin (e.g. CMB)"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
          />
          <InputGroupInput
            placeholder="Destination (e.g. JED)"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
        </div>
        <div className={deviationGrid2Cls}>
          <DateTimePicker
            value={departureAt}
            onChange={(e) => setDepartureAt(e)}
            label="Departure"
            placeholder="Pick departure date"
          />
          <DateTimePicker
            value={arrivalAt}
            onChange={(e) => setArrivalAt(e)}
            label="Arrival"
            placeholder="Pick arrival date"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={arrivesWithGroup}
            onCheckedChange={(v) => setArrivesWithGroup(v === true)}
          />
          Arrives with the group (transport still applies)
        </label>

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
      <DialogContent className="sm:max-w-lg! flex! max-h-[85vh] flex-col! overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Own Flight</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default OwnFlightDialog;
