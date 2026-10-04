"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import React, { useState, useTransition } from "react";

import type {
  DeviationDetail,
  DeviationType,
  DepartureGroupFlight,
  DepartureGroupAccommodation,
  DepartureGroupTransport,
  DepartureGroupManifestRow,
  ChargeType,
} from "../../../types";
import type { DepartureGroupPackageSnapshot } from "../../../types";
import {
  DEVIATION_FAMILY_META,
  DEVIATION_BY_TYPE,
  entriesForFamily,
  type DeviationFamily,
  type DeviationTypeEntry,
} from "./deviation-registry";
import { requestPilgrimCustomisationAction } from "../../../actions";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { DialogFooter } from "@/components/ui/dialog";

/* ── ServiceAddon catalogue row (from DB) ─────────────────────────────── */

export interface ServiceAddon {
  id: string;
  code: string;
  name: string;
  category: string;
  defaultAmount: number | null;
  unit: string;
  createsDeviation: boolean;
}

/* ── Props ─────────────────────────────────────────────────────────────── */

interface RequestDeviationFormProps {
  pilgrim: DepartureGroupManifestRow;
  departureGroupId: string;
  flights: DepartureGroupFlight[];
  accommodations: DepartureGroupAccommodation[];
  transports: DepartureGroupTransport[];
  itinerary: DepartureGroupPackageSnapshot["itinerary"];
  groupTravellers: { id: string; name: string }[];
  addons: ServiceAddon[];
  onClose: () => void;
}

/* ── Summary builder ──────────────────────────────────────────────────── */

function buildSummary(type: DeviationType, detail: DeviationDetail): string {
  switch (detail.kind) {
    case "EXTRA_NIGHTS":
      return `${detail.nights} extra night(s) in ${detail.city}, ${detail.side.toLowerCase()} group dates`;
    case "HOTEL_UPGRADE":
      return `Different hotel in ${detail.city}: ${detail.hotelName}`;
    case "MEAL_PLAN":
      return `Meal plan: ${detail.mealPlan}`;
    case "ROOMMATE_REQUEST":
      return `Roommate request (${detail.withPilgrimIds.length} traveller(s))${detail.note ? ` — ${detail.note}` : ""}`;
    case "OWN_FLIGHT":
      return `Own flight (${detail.direction.toLowerCase()}): ${detail.airline}${detail.flightNumber ? ` ${detail.flightNumber}` : ""}`;
    case "LAND_ONLY":
      return `Land only — no group flight${detail.note ? `: ${detail.note}` : ""}`;
    case "CABIN_UPGRADE":
      return `Cabin upgrade: ${detail.fromCabin} → ${detail.toCabin}`;
    case "SEAT_PREFERENCE":
      return `Seat preference: ${detail.preference.replace(/_/g, " ").toLowerCase()}${detail.note ? ` — ${detail.note}` : ""}`;
    case "EXTENDED_STAY":
      return `Extended stay — returns ${detail.newReturnDate}`;
    case "ITINERARY_OPT_OUT":
      return `Opts out of ${detail.itineraryItemIds.length} itinerary day(s)${detail.reason ? `: ${detail.reason}` : ""}`;
    case "ITINERARY_ADDITION":
      return `Additional activity: ${detail.title} at ${detail.location}`;
    case "SERVICE_ADDON":
      return `Service add-on${detail.addonCode ? `: ${detail.addonCode}` : ""}${detail.note ? ` — ${detail.note}` : ""} (×${detail.quantity})`;
    case "PRIVATE_TRANSFER":
      return `Private transfer: ${detail.route} (${detail.vehicleType.toLowerCase()})`;
    case "PICKUP_POINT":
      return `Different pickup: ${detail.pickupLocation}`;
    case "DOCUMENT_REQUIREMENT":
      return `Additional document: ${detail.documentName}`;
    case "ASSISTANCE":
      return `Assistance (${detail.assistanceType.toLowerCase()}): ${detail.details}`;
    case "ROOM_TYPE":
      return `Room type change`;
    case "OTHER":
      return detail.note;
    default:
      return "";
  }
}

/* ── Component ─────────────────────────────────────────────────────────── */

export default function RequestDeviationForm({
  pilgrim,
  departureGroupId,
  flights,
  accommodations,
  transports,
  itinerary,
  groupTravellers,
  addons,
  onClose,
}: RequestDeviationFormProps) {
  const [isPending, startTransition] = useTransition();

  const [family, setFamily] = useState<DeviationFamily>("accommodation");
  const [selectedType, setSelectedType] = useState<DeviationTypeEntry | null>(
    null,
  );
  const [summary, setSummary] = useState("");
  const [blocksDeparture, setBlocksDeparture] = useState(true);

  // Charge fields
  const [addCharge, setAddCharge] = useState(false);
  const [chargeLabel, setChargeLabel] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeReason, setChargeReason] = useState("");

  // Per-type state — kept flat for simplicity
  // Accommodation
  const [accCity, setAccCity] = useState<string>("MAKKAH");
  const [accNights, setAccNights] = useState("1");
  const [accSide, setAccSide] = useState<"BEFORE" | "AFTER">("AFTER");
  const [accAccommodationId, setAccAccommodationId] = useState<string>("");
  const [accHotelName, setAccHotelName] = useState("");
  const [accSupplierName, setAccSupplierName] = useState("");
  const [accDistance, setAccDistance] = useState("");
  const [accCheckIn, setAccCheckIn] = useState("");
  const [accCheckOut, setAccCheckOut] = useState("");
  const [accMealPlan, setAccMealPlan] = useState("");
  const [roommateIds, setRoommateIds] = useState<string[]>([]);
  const [roommateNote, setRoommateNote] = useState("");

  // Flight
  const [flightIds, setFlightIds] = useState<string[]>([]);
  const [flightDirection, setFlightDirection] = useState<string>("OUTBOUND");
  const [flightAirline, setFlightAirline] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [flightPnr, setFlightPnr] = useState("");
  const [flightOrigin, setFlightOrigin] = useState("");
  const [flightDest, setFlightDest] = useState("");
  const [flightDepartureAt, setFlightDepartureAt] = useState("");
  const [flightArrivalAt, setFlightArrivalAt] = useState("");
  const [arrivesWithGroup, setArrivesWithGroup] = useState(true);
  const [flightId, setFlightId] = useState("");
  const [cabinFrom, setCabinFrom] = useState("");
  const [cabinTo, setCabinTo] = useState("");
  const [seatPref, setSeatPref] = useState<string>("WINDOW");
  const [extReturnDate, setExtReturnDate] = useState("");
  const [extArrangement, setExtArrangement] = useState("");
  const [landNote, setLandNote] = useState("");

  // Itinerary
  const [optOutIds, setOptOutIds] = useState<string[]>([]);
  const [optOutReason, setOptOutReason] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addDayNumber, setAddDayNumber] = useState("");
  const [addLocation, setAddLocation] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addSupplier, setAddSupplier] = useState("");

  // Service
  const [addonId, setAddonId] = useState("");
  const [addonQuantity, setAddonQuantity] = useState("1");
  const [addonNote, setAddonNote] = useState("");

  // Transport
  const [transportId, setTransportId] = useState("");
  const [transferRoute, setTransferRoute] = useState("");
  const [transferVehicle, setTransferVehicle] = useState("PRIVATE_CAR");
  const [pickupLocation, setPickupLocation] = useState("");

  // Other
  const [docName, setDocName] = useState("");
  const [docStage, setDocStage] = useState("BEFORE_DEPARTURE");
  const [assistType, setAssistType] = useState("WHEELCHAIR");
  const [assistDetails, setAssistDetails] = useState("");
  const [otherNote, setOtherNote] = useState("");
  const [generalNote, setGeneralNote] = useState("");

  const reset = () => {
    setSelectedType(null);
    setSummary("");
    setBlocksDeparture(true);
    setAddCharge(false);
    setChargeLabel("");
    setChargeAmount("");
    setChargeReason("");
    setAccCity("MAKKAH");
    setAccNights("1");
    setAccSide("AFTER");
    setAccAccommodationId("");
    setAccHotelName("");
    setAccSupplierName("");
    setAccDistance("");
    setAccCheckIn("");
    setAccCheckOut("");
    setAccMealPlan("");
    setRoommateIds([]);
    setRoommateNote("");
    setFlightIds([]);
    setFlightDirection("OUTBOUND");
    setFlightAirline("");
    setFlightNumber("");
    setFlightPnr("");
    setFlightOrigin("");
    setFlightDest("");
    setFlightDepartureAt("");
    setFlightArrivalAt("");
    setArrivesWithGroup(true);
    setFlightId("");
    setCabinFrom("");
    setCabinTo("");
    setSeatPref("WINDOW");
    setExtReturnDate("");
    setExtArrangement("");
    setLandNote("");
    setOptOutIds([]);
    setOptOutReason("");
    setAddTitle("");
    setAddDayNumber("");
    setAddLocation("");
    setAddDescription("");
    setAddSupplier("");
    setAddonId("");
    setAddonQuantity("1");
    setAddonNote("");
    setTransportId("");
    setTransferRoute("");
    setTransferVehicle("PRIVATE_CAR");
    setPickupLocation("");
    setDocName("");
    setDocStage("BEFORE_DEPARTURE");
    setAssistType("WHEELCHAIR");
    setAssistDetails("");
    setOtherNote("");
    setGeneralNote("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const selectType = (entry: DeviationTypeEntry) => {
    setSelectedType(entry);
    setBlocksDeparture(entry.defaultBlocksDeparture);
    if (entry.suggestsCharge) {
      setAddCharge(true);
    } else {
      setAddCharge(false);
    }
    setChargeLabel("");
    setChargeAmount("");
    setChargeReason("");

    if (entry.type === "SERVICE_ADDON" && addons.length > 0) {
      setAddonId(addons[0].id);
      const first = addons[0];
      if (first.defaultAmount != null) {
        setChargeAmount(String(first.defaultAmount));
        setChargeLabel(first.name);
      }
    }
  };

  const buildDetail = (): DeviationDetail | null => {
    if (!selectedType) return null;
    const t = selectedType.type;

    switch (t) {
      case "EXTRA_NIGHTS":
        if (!accCity || !accNights || Number(accNights) < 1) return null;
        return {
          kind: "EXTRA_NIGHTS",
          accommodationId: accAccommodationId || null,
          city: accCity as DeviationDetail & { kind: "EXTRA_NIGHTS" } extends {
            city: infer C;
          }
            ? C
            : never,
          nights: Number(accNights),
          side: accSide,
          ...(accCheckIn ? { checkInDate: accCheckIn } : {}),
          ...(accCheckOut ? { checkOutDate: accCheckOut } : {}),
        };
      case "HOTEL_UPGRADE":
        if (!accHotelName.trim()) return null;
        return {
          kind: "HOTEL_UPGRADE",
          fromAccommodationId: accAccommodationId || null,
          city: accCity as DeviationDetail & { kind: "HOTEL_UPGRADE" } extends {
            city: infer C;
          }
            ? C
            : never,
          hotelName: accHotelName.trim(),
          ...(accSupplierName ? { supplierName: accSupplierName } : {}),
          ...(accDistance ? { distanceDescription: accDistance } : {}),
          ...(accCheckIn ? { checkInDate: accCheckIn } : {}),
          ...(accCheckOut ? { checkOutDate: accCheckOut } : {}),
        };
      case "MEAL_PLAN":
        if (!accMealPlan.trim()) return null;
        return {
          kind: "MEAL_PLAN",
          accommodationId: accAccommodationId || null,
          mealPlan: accMealPlan.trim(),
        };
      case "ROOMMATE_REQUEST":
        if (roommateIds.length === 0) return null;
        return {
          kind: "ROOMMATE_REQUEST",
          withPilgrimIds: roommateIds,
          ...(roommateNote ? { note: roommateNote } : {}),
        };
      case "OWN_FLIGHT":
        if (!flightAirline.trim()) return null;
        return {
          kind: "OWN_FLIGHT",
          replacesFlightIds: flightIds,
          direction: flightDirection as "OUTBOUND" | "RETURN" | "BOTH",
          airline: flightAirline.trim(),
          ...(flightNumber ? { flightNumber } : {}),
          ...(flightPnr ? { pnr: flightPnr } : {}),
          ...(flightOrigin ? { originAirportCode: flightOrigin } : {}),
          ...(flightDest ? { destinationAirportCode: flightDest } : {}),
          ...(flightDepartureAt ? { departureAt: flightDepartureAt } : {}),
          ...(flightArrivalAt ? { arrivalAt: flightArrivalAt } : {}),
          arrivesWithGroup,
        };
      case "LAND_ONLY":
        if (flightIds.length === 0) return null;
        return {
          kind: "LAND_ONLY",
          replacesFlightIds: flightIds,
          ...(landNote ? { note: landNote } : {}),
        };
      case "CABIN_UPGRADE":
        if (!flightId || !cabinFrom.trim() || !cabinTo.trim()) return null;
        return {
          kind: "CABIN_UPGRADE",
          flightId,
          fromCabin: cabinFrom.trim(),
          toCabin: cabinTo.trim(),
          ...(flightPnr ? { pnr: flightPnr } : {}),
        };
      case "SEAT_PREFERENCE":
        if (!flightId) return null;
        return {
          kind: "SEAT_PREFERENCE",
          flightId,
          preference: seatPref as
            | "WINDOW"
            | "AISLE"
            | "EXTRA_LEGROOM"
            | "BULKHEAD"
            | "TOGETHER"
            | "OTHER",
          ...(generalNote ? { note: generalNote } : {}),
        };
      case "EXTENDED_STAY":
        if (!extReturnDate || !extArrangement.trim()) return null;
        return {
          kind: "EXTENDED_STAY",
          returnFlightId: flightId || null,
          newReturnDate: extReturnDate,
          onwardArrangement: extArrangement.trim(),
        };
      case "ITINERARY_OPT_OUT":
        if (optOutIds.length === 0) return null;
        return {
          kind: "ITINERARY_OPT_OUT",
          itineraryItemIds: optOutIds,
          ...(optOutReason ? { reason: optOutReason } : {}),
        };
      case "ITINERARY_ADDITION":
        if (!addTitle.trim() || !addLocation.trim()) return null;
        return {
          kind: "ITINERARY_ADDITION",
          title: addTitle.trim(),
          dayNumber: addDayNumber ? Number(addDayNumber) : null,
          location: addLocation.trim(),
          description: addDescription,
          ...(addSupplier ? { supplierName: addSupplier } : {}),
        };
      case "SERVICE_ADDON":
        if (!addonId && !addonNote.trim()) return null;
        return {
          kind: "SERVICE_ADDON",
          addonId: addonId || null,
          ...(addonId
            ? { addonCode: addons.find((a) => a.id === addonId)?.code }
            : {}),
          quantity: Number(addonQuantity) || 1,
          ...(addonNote ? { note: addonNote } : {}),
        };
      case "PRIVATE_TRANSFER":
        if (!transferRoute.trim()) return null;
        return {
          kind: "PRIVATE_TRANSFER",
          transportId: transportId || null,
          route: transferRoute.trim(),
          vehicleType: transferVehicle as
            "COACH" | "VAN" | "PRIVATE_CAR" | "TRAIN" | "OTHER",
        };
      case "PICKUP_POINT":
        if (!pickupLocation.trim()) return null;
        return {
          kind: "PICKUP_POINT",
          transportId: transportId || null,
          pickupLocation: pickupLocation.trim(),
        };
      case "DOCUMENT_REQUIREMENT":
        if (!docName.trim()) return null;
        return {
          kind: "DOCUMENT_REQUIREMENT",
          documentName: docName.trim(),
          requiredByStage: docStage as
            | "ON_BOOKING"
            | "BEFORE_VISA_SUBMISSION"
            | "BEFORE_FINAL_PAYMENT"
            | "BEFORE_DEPARTURE",
        };
      case "ASSISTANCE":
        if (!assistDetails.trim()) return null;
        return {
          kind: "ASSISTANCE",
          assistanceType: assistType as
            "WHEELCHAIR" | "MEDICAL" | "DIETARY" | "MOBILITY" | "OTHER",
          details: assistDetails.trim(),
        };
      case "OTHER":
        if (!otherNote.trim()) return null;
        return { kind: "OTHER", note: otherNote.trim() };
      default:
        return null;
    }
  };

  const handleSubmit = () => {
    const detail = buildDetail();
    if (!detail || !selectedType) return;

    const finalSummary =
      summary.trim() || buildSummary(selectedType.type, detail);
    if (finalSummary.length < 3) {
      toast.add({
        title: "Summary too short",
        description: "Describe the deviation.",
      });
      return;
    }

    const charge =
      addCharge && chargeLabel.trim() && chargeAmount
        ? {
            chargeType: (selectedType.suggestedChargeType ??
              "ADDON") as ChargeType,
            label: chargeLabel.trim(),
            amount:
              (selectedType.suggestedChargeType ?? "ADDON") === "DISCOUNT"
                ? -Math.abs(Number(chargeAmount))
                : Math.abs(Number(chargeAmount)),
            quantity: 1,
            requiresApproval: false,
            reason: chargeReason || undefined,
            // Keeps the charge linked back to the catalogue add-on it was
            // generated from, so a SERVICE_ADDON deviation's charge stays
            // traceable to `addonId`/`source` rather than becoming a bare
            // manual line item.
            addonId:
              selectedType.type === "SERVICE_ADDON" && addonId
                ? addonId
                : undefined,
          }
        : undefined;

    startTransition(async () => {
      try {
        const result = await requestPilgrimCustomisationAction({
          departureGroupId,
          groupPilgrimId: pilgrim.id,
          deviationType: selectedType.type,
          summary: finalSummary,
          detail,
          blocksDeparture,
          notes: generalNote || undefined,
          charge,
        });
        if (!result.ok) {
          toast.add({ title: "Could not create", description: result.error });
          return;
        }
        toast.add({
          title: "Customisation created",
          description: pilgrim.fullName,
        });
        handleClose();
      } catch {
        toast.add({
          title: "Error",
          description: "The change did not reach the server.",
        });
      }
    });
  };

  const flightLabel = (f: DepartureGroupFlight) =>
    `${f.airline}${f.flightNumber ? ` ${f.flightNumber}` : ""} · ${f.originAirportCode}→${f.destinationAirportCode} · ${f.direction.toLowerCase()}`;

  const families = Object.entries(DEVIATION_FAMILY_META) as [
    DeviationFamily,
    (typeof DEVIATION_FAMILY_META)[DeviationFamily],
  ][];

  const entries = entriesForFamily(family);

  return (
    <div className="flex flex-col gap-0">
      <div className="flex flex-col gap-4 overflow-y-auto custom-scroll flex-1 min-h-0 pb-2">
      <p className="text-xs text-muted-foreground">
        Choose a category, then the specific change.
      </p>

      {/* Family tabs */}
      <div className="flex gap-1 border-b border-border/40 pb-1">
        {families.map(([fam, meta]) => (
          <button
            key={fam}
            type="button"
            onClick={() => {
              setFamily(fam);
              setSelectedType(null);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors",
              family === fam
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            <meta.Icon className="size-3.5" />
            {meta.label}
          </button>
        ))}
      </div>

      {/* Type picker */}
      {!selectedType && (
        <div className="grid grid-cols-2 gap-2">
          {entries.map((entry) => (
            <button
              key={entry.type}
              type="button"
              onClick={() => selectType(entry)}
              className="rounded-md border border-border/50 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors"
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      {/* Type-specific form */}
      {selectedType && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">{selectedType.label}</h4>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setSelectedType(null)}
            >
              Change type
            </Button>
          </div>

          {/* ── Accommodation forms ─────────────────────────────── */}
          {selectedType.type === "EXTRA_NIGHTS" && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-2">
                <Select value={accCity} onValueChange={(value) => setAccCity(value as string)}>
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["MAKKAH", "MADINAH", "MINA", "ARAFAT", "OTHER"].map((c) => (
                      <SelectItem key={c} value={c} className="text-xs">
                        {c.charAt(0) + c.slice(1).toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  placeholder="Nights"
                  value={accNights}
                  onChange={(e) => setAccNights(e.target.value)}
                />
                <Select
                  value={accSide}
                  onValueChange={(value) =>
                    setAccSide(value as "BEFORE" | "AFTER")
                  }
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BEFORE" className="text-xs">
                      Before group
                    </SelectItem>
                    <SelectItem value="AFTER" className="text-xs">
                      After group
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {accommodations.length > 0 && (
                <Select
                  value={accAccommodationId}
                  onValueChange={(value) => setAccAccommodationId(value as string)}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Link to accommodation (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {accommodations.map((a) => (
                      <SelectItem key={a.id} value={a.id} className="text-xs">
                        {a.hotelName} — {a.city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  placeholder="Check-in"
                  value={accCheckIn}
                  onChange={(e) => setAccCheckIn(e.target.value)}
                />
                <Input
                  type="date"
                  placeholder="Check-out"
                  value={accCheckOut}
                  onChange={(e) => setAccCheckOut(e.target.value)}
                />
              </div>
            </div>
          )}

          {selectedType.type === "HOTEL_UPGRADE" && (
            <div className="flex flex-col gap-2">
              {accommodations.length > 0 && (
                <Select
                  value={accAccommodationId}
                  onValueChange={(value) => setAccAccommodationId(value as string)}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Replacing which accommodation?" />
                  </SelectTrigger>
                  <SelectContent>
                    {accommodations.map((a) => (
                      <SelectItem key={a.id} value={a.id} className="text-xs">
                        {a.hotelName} — {a.city} ({a.checkInDate} to{" "}
                        {a.checkOutDate})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={accCity} onValueChange={(value) => setAccCity(value as string)}>
                <SelectTrigger className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["MAKKAH", "MADINAH", "MINA", "ARAFAT", "OTHER"].map((c) => (
                    <SelectItem key={c} value={c} className="text-xs">
                      {c.charAt(0) + c.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="New hotel name"
                value={accHotelName}
                onChange={(e) => setAccHotelName(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Supplier (optional)"
                  value={accSupplierName}
                  onChange={(e) => setAccSupplierName(e.target.value)}
                />
                <Input
                  placeholder="Distance (optional)"
                  value={accDistance}
                  onChange={(e) => setAccDistance(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  placeholder="Check-in"
                  value={accCheckIn}
                  onChange={(e) => setAccCheckIn(e.target.value)}
                />
                <Input
                  type="date"
                  placeholder="Check-out"
                  value={accCheckOut}
                  onChange={(e) => setAccCheckOut(e.target.value)}
                />
              </div>
            </div>
          )}

          {selectedType.type === "MEAL_PLAN" && (
            <div className="flex flex-col gap-2">
              {accommodations.length > 0 && (
                <Select
                  value={accAccommodationId}
                  onValueChange={(value) => setAccAccommodationId(value as string)}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Link to accommodation (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {accommodations.map((a) => (
                      <SelectItem key={a.id} value={a.id} className="text-xs">
                        {a.hotelName} — {a.city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                placeholder="Meal plan — e.g. Full board, Breakfast only"
                value={accMealPlan}
                onChange={(e) => setAccMealPlan(e.target.value)}
              />
            </div>
          )}

          {selectedType.type === "ROOMMATE_REQUEST" && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Select travellers this person wants to room with:
              </p>
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {groupTravellers
                  .filter((t) => t.id !== pilgrim.id)
                  .map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={roommateIds.includes(t.id)}
                        onCheckedChange={(checked) =>
                          setRoommateIds((prev) =>
                            checked
                              ? [...prev, t.id]
                              : prev.filter((id) => id !== t.id),
                          )
                        }
                      />
                      {t.name}
                    </label>
                  ))}
              </div>
              <Input
                placeholder="Note (optional)"
                value={roommateNote}
                onChange={(e) => setRoommateNote(e.target.value)}
              />
            </div>
          )}

          {/* ── Flight forms ─────────────────────────────────────── */}
          {selectedType.type === "OWN_FLIGHT" && (
            <div className="flex flex-col gap-2">
              <Select
                value={flightDirection}
                onValueChange={(value) => setFlightDirection(value as string)}
              >
                <SelectTrigger className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OUTBOUND" className="text-xs">
                    Outbound
                  </SelectItem>
                  <SelectItem value="RETURN" className="text-xs">
                    Return
                  </SelectItem>
                  <SelectItem value="BOTH" className="text-xs">
                    Both
                  </SelectItem>
                </SelectContent>
              </Select>
              {flights.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">
                    Replaces which group flight(s)?
                  </p>
                  {flights.map((f) => (
                    <label
                      key={f.id}
                      className="flex items-center gap-2 text-sm"
                    >
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
              <Input
                placeholder="Airline"
                value={flightAirline}
                onChange={(e) => setFlightAirline(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Flight number"
                  value={flightNumber}
                  onChange={(e) => setFlightNumber(e.target.value)}
                />
                <Input
                  placeholder="PNR"
                  value={flightPnr}
                  onChange={(e) => setFlightPnr(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Origin (e.g. CMB)"
                  value={flightOrigin}
                  onChange={(e) => setFlightOrigin(e.target.value)}
                />
                <Input
                  placeholder="Destination (e.g. JED)"
                  value={flightDest}
                  onChange={(e) => setFlightDest(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="datetime-local"
                  placeholder="Departure"
                  value={flightDepartureAt}
                  onChange={(e) => setFlightDepartureAt(e.target.value)}
                />
                <Input
                  type="datetime-local"
                  placeholder="Arrival"
                  value={flightArrivalAt}
                  onChange={(e) => setFlightArrivalAt(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={arrivesWithGroup}
                  onCheckedChange={(v) => setArrivesWithGroup(v === true)}
                />
                Arrives with the group (transport still applies)
              </label>
            </div>
          )}

          {selectedType.type === "LAND_ONLY" && (
            <div className="flex flex-col gap-2">
              {flights.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">
                    Which group flight(s) does this replace?
                  </p>
                  {flights.map((f) => (
                    <label
                      key={f.id}
                      className="flex items-center gap-2 text-sm"
                    >
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
              <Input
                placeholder="Note (optional)"
                value={landNote}
                onChange={(e) => setLandNote(e.target.value)}
              />
            </div>
          )}

          {selectedType.type === "CABIN_UPGRADE" && (
            <div className="flex flex-col gap-2">
              {flights.length > 0 && (
                <Select value={flightId} onValueChange={(value) => setFlightId(value as string)}>
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Select flight" />
                  </SelectTrigger>
                  <SelectContent>
                    {flights.map((f) => (
                      <SelectItem key={f.id} value={f.id} className="text-xs">
                        {flightLabel(f)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="From cabin class"
                  value={cabinFrom}
                  onChange={(e) => setCabinFrom(e.target.value)}
                />
                <Input
                  placeholder="To cabin class"
                  value={cabinTo}
                  onChange={(e) => setCabinTo(e.target.value)}
                />
              </div>
              <Input
                placeholder="PNR (optional)"
                value={flightPnr}
                onChange={(e) => setFlightPnr(e.target.value)}
              />
            </div>
          )}

          {selectedType.type === "SEAT_PREFERENCE" && (
            <div className="flex flex-col gap-2">
              {flights.length > 0 && (
                <Select value={flightId} onValueChange={(value) => setFlightId(value as string)}>
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Select flight" />
                  </SelectTrigger>
                  <SelectContent>
                    {flights.map((f) => (
                      <SelectItem key={f.id} value={f.id} className="text-xs">
                        {flightLabel(f)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={seatPref} onValueChange={(value) => setSeatPref(value as string)}>
                <SelectTrigger className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "WINDOW",
                    "AISLE",
                    "EXTRA_LEGROOM",
                    "BULKHEAD",
                    "TOGETHER",
                    "OTHER",
                  ].map((p) => (
                    <SelectItem key={p} value={p} className="text-xs">
                      {p.replace(/_/g, " ").toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Note (optional)"
                value={generalNote}
                onChange={(e) => setGeneralNote(e.target.value)}
              />
            </div>
          )}

          {selectedType.type === "EXTENDED_STAY" && (
            <div className="flex flex-col gap-2">
              {flights.length > 0 && (
                <Select value={flightId} onValueChange={(value) => setFlightId(value as string)}>
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Link to return flight (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {flights
                      .filter((f) => f.direction === "RETURN")
                      .map((f) => (
                        <SelectItem key={f.id} value={f.id} className="text-xs">
                          {flightLabel(f)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                type="date"
                placeholder="New return date"
                value={extReturnDate}
                onChange={(e) => setExtReturnDate(e.target.value)}
              />
              <Input
                placeholder="How does the traveller return? E.g. own ticket"
                value={extArrangement}
                onChange={(e) => setExtArrangement(e.target.value)}
              />
            </div>
          )}

          {/* ── Itinerary forms ──────────────────────────────────── */}
          {selectedType.type === "ITINERARY_OPT_OUT" && (
            <div className="flex flex-col gap-2">
              {itinerary.length > 0 ? (
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                  {itinerary.map((item) => (
                    <label
                      key={item.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={optOutIds.includes(item.id)}
                        onCheckedChange={(checked) =>
                          setOptOutIds((prev) =>
                            checked
                              ? [...prev, item.id]
                              : prev.filter((id) => id !== item.id),
                          )
                        }
                      />
                      Day {item.dayNumber}: {item.title} — {item.location}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No itinerary items in the package snapshot.
                </p>
              )}
              <Input
                placeholder="Reason (optional)"
                value={optOutReason}
                onChange={(e) => setOptOutReason(e.target.value)}
              />
            </div>
          )}

          {selectedType.type === "ITINERARY_ADDITION" && (
            <div className="flex flex-col gap-2">
              <Input
                placeholder="Activity title"
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min={1}
                  placeholder="Day number"
                  value={addDayNumber}
                  onChange={(e) => setAddDayNumber(e.target.value)}
                />
                <Input
                  placeholder="Location"
                  value={addLocation}
                  onChange={(e) => setAddLocation(e.target.value)}
                />
              </div>
                <InputGroup>
                  <InputGroupAddon align={"block-start"}>
                    <InputGroupText>Description</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupTextarea
                rows={2}
                placeholder="Description (optional)"
                value={addDescription}
                onChange={(e) => setAddDescription(e.target.value)}
              />
                </InputGroup>
              <Input
                placeholder="Supplier (optional)"
                value={addSupplier}
                onChange={(e) => setAddSupplier(e.target.value)}
              />
            </div>
          )}

          {selectedType.type === "SERVICE_ADDON" && (
            <div className="flex flex-col gap-2">
              {addons.length > 0 ? (
                <Select
                  value={addonId}
                  onValueChange={(value) => {
                    const addonValue = value as string;
                    setAddonId(addonValue);
                    const addon = addons.find((a) => a.id === addonValue);
                    if (addon?.defaultAmount != null) {
                      setChargeAmount(String(addon.defaultAmount));
                      setChargeLabel(addon.name);
                    }
                  }}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Select add-on" />
                  </SelectTrigger>
                  <SelectContent>
                    {addons.map((a) => (
                      <SelectItem key={a.id} value={a.id} className="text-xs">
                        {a.name}{" "}
                        {a.defaultAmount != null
                          ? `(${a.defaultAmount} LKR)`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No add-ons configured. Type a description below.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min={1}
                  placeholder="Quantity"
                  value={addonQuantity}
                  onChange={(e) => setAddonQuantity(e.target.value)}
                />
                <Input
                  placeholder="Note (optional)"
                  value={addonNote}
                  onChange={(e) => setAddonNote(e.target.value)}
                />
              </div>
            </div>
          )}

          {selectedType.type === "PRIVATE_TRANSFER" && (
            <div className="flex flex-col gap-2">
              {transports.length > 0 && (
                <Select
                  value={transportId}
                  onValueChange={(value) => setTransportId(value as string)}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Link to group transport (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {transports.map((t) => (
                      <SelectItem key={t.id} value={t.id} className="text-xs">
                        {t.routeLabel}: {t.origin} → {t.destination}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                placeholder="Route — e.g. Airport to Makkah hotel"
                value={transferRoute}
                onChange={(e) => setTransferRoute(e.target.value)}
              />
              <Select
                value={transferVehicle}
                onValueChange={(value) => setTransferVehicle(value as string)}
              >
                <SelectTrigger className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["PRIVATE_CAR", "VAN", "COACH", "OTHER"].map((v) => (
                    <SelectItem key={v} value={v} className="text-xs">
                      {v.replace(/_/g, " ").toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedType.type === "PICKUP_POINT" && (
            <div className="flex flex-col gap-2">
              {transports.length > 0 && (
                <Select
                  value={transportId}
                  onValueChange={(value) => setTransportId(value as string)}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Link to group transport (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {transports.map((t) => (
                      <SelectItem key={t.id} value={t.id} className="text-xs">
                        {t.routeLabel}: {t.origin} → {t.destination}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                placeholder="Pickup location"
                value={pickupLocation}
                onChange={(e) => setPickupLocation(e.target.value)}
              />
            </div>
          )}

          {/* ── Other forms ──────────────────────────────────────── */}
          {selectedType.type === "DOCUMENT_REQUIREMENT" && (
            <div className="flex flex-col gap-2">
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>Document Name</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="e.g Medical"
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                />
              </InputGroup>
              <Select value={docStage} onValueChange={(value) => setDocStage(value as string)}>
                <SelectTrigger className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ON_BOOKING" className="text-xs">
                    On booking
                  </SelectItem>
                  <SelectItem value="BEFORE_VISA_SUBMISSION" className="text-xs">
                    Before visa submission
                  </SelectItem>
                  <SelectItem value="BEFORE_FINAL_PAYMENT" className="text-xs">
                    Before final payment
                  </SelectItem>
                  <SelectItem value="BEFORE_DEPARTURE" className="text-xs">
                    Before departure
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedType.type === "ASSISTANCE" && (
            <div className="flex flex-col gap-2">
              <Select value={assistType} onValueChange={(value) => setAssistType(value as string)}>
                <SelectTrigger className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["WHEELCHAIR", "MEDICAL", "DIETARY", "MOBILITY", "OTHER"].map(
                    (t) => (
                      <SelectItem key={t} value={t} className="text-xs">
                        {t.charAt(0) + t.slice(1).toLowerCase()}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <Textarea
                rows={2}
                placeholder="Describe the assistance needed"
                value={assistDetails}
                onChange={(e) => setAssistDetails(e.target.value)}
              />
            </div>
          )}

          {selectedType.type === "OTHER" && (
            <Textarea
              rows={3}
              placeholder="Describe the deviation"
              value={otherNote}
              onChange={(e) => setOtherNote(e.target.value)}
            />
          )}

          {/* ── Summary ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              Summary (auto-generated, editable)
            </label>
            <Input
              placeholder="Brief description for the manifest"
              value={
                summary ||
                (buildDetail()
                  ? buildSummary(selectedType.type, buildDetail()!)
                  : "")
              }
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>

          {/* ── Charge block ────────────────────────────────────── */}
          <div className="rounded-md border border-border/40 p-3 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs font-medium">
              <Checkbox
                checked={addCharge}
                onCheckedChange={(v) => setAddCharge(v === true)}
              />
              Add a charge for this
            </label>
            {addCharge && (
              <div className="flex flex-col gap-2 pl-5">
                <Input
                  placeholder="Charge label"
                  value={chargeLabel}
                  onChange={(e) => setChargeLabel(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    placeholder="Amount (LKR)"
                    value={chargeAmount}
                    onChange={(e) => setChargeAmount(e.target.value)}
                  />
                  <Input
                    placeholder="Reason (optional)"
                    value={chargeReason}
                    onChange={(e) => setChargeReason(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Blocks departure ────────────────────────────────── */}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={blocksDeparture}
              onCheckedChange={(v) => setBlocksDeparture(v === true)}
            />
            Must be resolved before the group can depart
          </label>

          {/* ── Notes ───────────────────────────────────────────── */}
          <Textarea
            rows={2}
            placeholder="Internal notes (optional)"
            value={generalNote}
            onChange={(e) => setGeneralNote(e.target.value)}
          />
          </div>
        )}
      </div>

      {/* ── Footer — always visible ──────────────────────────────── */}
      <DialogFooter className="flex justify-end gap-2 pt-3 border-t border-border/40">
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
        {selectedType && (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isPending || !buildDetail()}
            >
              {isPending && <Loader2 className="animate-spin" />}
              Create customisation
            </Button>
      )}
      </DialogFooter>
    </div>
  );
}
