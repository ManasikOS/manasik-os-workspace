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

interface HotelUpgradeDialogProps {
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

const HotelUpgradeDialog = ({
  row,
  departureGroupId,
  accommodations,
  open,
  onClose,
  embedded = false,
}: HotelUpgradeDialogProps) => {
  const [accommodationId, setAccommodationId] = useState("");
  const [city, setCity] = useState<AccommodationCity>("MAKKAH");
  const [hotelName, setHotelName] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [distance, setDistance] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");

  const common = useDeviationCommonFields({
    blocksDeparture: true,
    addCharge: true,
  });

  useResetOnOpen(open, row?.id ?? "", () => {
    setAccommodationId("");
    setCity("MAKKAH");
    setHotelName("");
    setSupplierName("");
    setDistance("");
    setCheckIn("");
    setCheckOut("");
    common.reset();
  });

  const detail = hotelName.trim()
    ? {
        kind: "HOTEL_UPGRADE" as const,
        fromAccommodationId: accommodationId || null,
        city,
        hotelName: hotelName.trim(),
        ...(supplierName ? { supplierName } : {}),
        ...(distance ? { distanceDescription: distance } : {}),
        ...(checkIn ? { checkInDate: checkIn } : {}),
        ...(checkOut ? { checkOutDate: checkOut } : {}),
      }
    : null;

  const autoSummary = detail
    ? `Different hotel in ${detail.city}: ${detail.hotelName}`
    : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "HOTEL_UPGRADE",
    suggestedChargeType: "ROOM_UPGRADE",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        {accommodations.length > 0 && (
          <SelectMenu
            label="Current Accommodation"
            onChange={(e) => setAccommodationId(e)}
            value={accommodationId}
            options={accommodations.map((e) => ({
              value: e.id,
              label:
                e.hotelName +
                " - " +
                e.city.charAt(0) +
                e.city.slice(1).toLowerCase() +
                `  (${e.checkInDate} to ${e.checkOutDate})`,
            }))}
          />
        )}

        <SelectMenu
          label="City"
          value={city}
          onChange={(e) => setCity(e as AccommodationCity)}
          options={CITIES.map((c) => ({
            value: c,
            label: c.charAt(0) + c.slice(1).toLowerCase(),
          }))}
        />
        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText>New Hotel Name</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            placeholder="e.g Raffles Hotel"
            value={hotelName}
            onChange={(e) => setHotelName(e.target.value)}
          />
        </InputGroup>
        <div className={deviationGrid2Cls}>
          <InputGroup>
            <InputGroupAddon align={"block-start"}>
              <InputGroupText>Supplier (Optional)</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              placeholder="e.g Raffles"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
            />
          </InputGroup>
          <InputGroup>
            <InputGroupAddon align={"block-start"}>
              <InputGroupText>Distance (Optional)</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              placeholder="e.g 450m to Haram"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
          </InputGroup>
        </div>
        <div className={deviationGrid2Cls}>
          <DatePicker
            label="Check-in"
            value={checkIn}
            onChange={(e) => setCheckIn(e)}
          />
          <DatePicker
            label="Check-out"
            value={checkOut}
            onChange={(e) => setCheckOut(e)}
          />
        </div>

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
          <DialogTitle>Different Hotel</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default HotelUpgradeDialog;
