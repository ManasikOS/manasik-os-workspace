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
  AccommodationCity,
  DepartureGroupAccommodation,
  DepartureGroupManifestRow,
} from "../../../../types";
import {
  DeviationCommonFields,
  DeviationFormFooter,
  deviationFieldsCls,
  deviationGrid2Cls,
  deviationGrid3Cls,
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
import { DatePicker } from "@/components/date-time-picker";

interface ExtraNightsDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  accommodations: DepartureGroupAccommodation[];
  open: boolean;
  onClose: () => void;
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const CITIES: AccommodationCity[] = [
  "MAKKAH",
  "MADINAH",
  "MINA",
  "ARAFAT",
  "OTHER",
];

const ExtraNightsDialog = ({
  row,
  departureGroupId,
  accommodations,
  open,
  onClose,
  embedded = false,
}: ExtraNightsDialogProps) => {
  const [city, setCity] = useState<AccommodationCity>("MAKKAH");
  const [nights, setNights] = useState("1");
  const [side, setSide] = useState<"BEFORE" | "AFTER">("AFTER");
  const [accommodationId, setAccommodationId] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");

  const common = useDeviationCommonFields({
    blocksDeparture: true,
    addCharge: true,
  });

  useResetOnOpen(open, row?.id ?? "", () => {
    setCity("MAKKAH");
    setNights("1");
    setSide("AFTER");
    setAccommodationId("");
    setCheckIn("");
    setCheckOut("");
    common.reset();
  });

  const nightsNum = Number(nights);
  const detail =
    city && nightsNum >= 1
      ? {
          kind: "EXTRA_NIGHTS" as const,
          accommodationId: accommodationId || null,
          city,
          nights: nightsNum,
          side,
          ...(checkIn ? { checkInDate: checkIn } : {}),
          ...(checkOut ? { checkOutDate: checkOut } : {}),
        }
      : null;

  const autoSummary = detail
    ? `${detail.nights} extra night(s) in ${detail.city}, ${detail.side.toLowerCase()} group dates`
    : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "EXTRA_NIGHTS",
    suggestedChargeType: "EXTRA_NIGHTS",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        <div className={deviationGrid3Cls}>
          <SelectMenu
            label="City"
            onChange={(e) => setCity(e as AccommodationCity)}
            options={CITIES.map((e) => ({
              label: e.charAt(0) + e.slice(1).toLowerCase(),
              value: e,
            }))}
            value={city}
          />

          <InputGroup>
            <InputGroupAddon align={"block-start"}>
              <InputGroupText>Nights</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              type="number"
              min={1}
              placeholder="Nights"
              value={nights}
              onChange={(e) => setNights(e.target.value)}
            />
          </InputGroup>
          <SelectMenu
            label="Side"
            onChange={(e) => setSide(e.split(" ")[0] as "BEFORE" | "AFTER")}
            options={["BEFORE Group", "AFTER Group"].map((e) => ({
              label: e.charAt(0) + e.slice(1).toLowerCase(),
              value: e.split(" ")[0],
            }))}
            value={side}
          />
        </div>
        {accommodations.length > 0 && (
          <SelectMenu
            label="Accommodation"
            onChange={(e) => setAccommodationId(e)}
            options={accommodations.map((e) => ({
              label: e.hotelName + " - " + e.city,
              value: e.id,
            }))}
            value={accommodationId}
          />
        )}
        <div className={deviationGrid2Cls}>
          <DatePicker
            label="Check-in"
            onChange={(e) => setCheckIn(e)}
            value={checkIn}
            placeholder="Select Check-in date"
          />
          <DatePicker
            label="Check-out"
            onChange={(e) => setCheckOut(e)}
            value={checkOut}
            placeholder="Select Check-out date"
          />
        </div>

        <DeviationCommonFields
          common={common}
          autoSummary={autoSummary}
          chargeQuantity={nightsNum >= 1 ? nightsNum : 1}
          chargeQuantityLabel="nights"
        />
      </div>

      <DeviationFormFooter
        embedded={embedded}
        onClose={onClose}
        onSubmit={() =>
          submit(detail, common, autoSummary, nightsNum >= 1 ? nightsNum : 1)
        }
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
          <DialogTitle>Extra Nights</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default ExtraNightsDialog;
