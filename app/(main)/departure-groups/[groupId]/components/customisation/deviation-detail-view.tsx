"use client";

import type { DeviationDetail, PilgrimDeviation } from "../../../types";
import { ROOM_TYPE_LABELS, formatDate } from "../../../utils";

interface DeviationDetailViewProps {
  deviation: PilgrimDeviation;
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <span className="text-[11px] text-muted-foreground">
      <span className="text-muted-foreground/70">{label}:</span> {value}
    </span>
  );
}

export default function DeviationDetailView({ deviation }: DeviationDetailViewProps) {
  const d = deviation.detail;
  if (!("kind" in d)) return null;
  const detail = d as DeviationDetail;

  switch (detail.kind) {
    case "ROOM_TYPE":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="Room type" value={ROOM_TYPE_LABELS[detail.roomType]} />
        </div>
      );

    case "EXTRA_NIGHTS":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="City" value={detail.city} />
          <DetailRow label="Nights" value={String(detail.nights)} />
          <DetailRow label="Side" value={detail.side === "BEFORE" ? "Before group" : "After group"} />
          {detail.checkInDate && <DetailRow label="Check-in" value={formatDate(detail.checkInDate)} />}
          {detail.checkOutDate && <DetailRow label="Check-out" value={formatDate(detail.checkOutDate)} />}
        </div>
      );

    case "HOTEL_UPGRADE":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="City" value={detail.city} />
          <DetailRow label="Hotel" value={detail.hotelName} />
          {detail.supplierName && <DetailRow label="Supplier" value={detail.supplierName} />}
          {detail.distanceDescription && <DetailRow label="Distance" value={detail.distanceDescription} />}
          {detail.checkInDate && <DetailRow label="Check-in" value={formatDate(detail.checkInDate)} />}
          {detail.checkOutDate && <DetailRow label="Check-out" value={formatDate(detail.checkOutDate)} />}
        </div>
      );

    case "MEAL_PLAN":
      return <DetailRow label="Meal plan" value={detail.mealPlan} />;

    case "ROOMMATE_REQUEST":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="With" value={`${detail.withPilgrimIds.length} traveller(s)`} />
          {detail.note && <DetailRow label="Note" value={detail.note} />}
        </div>
      );

    case "OWN_FLIGHT":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="Direction" value={detail.direction} />
          <DetailRow label="Airline" value={detail.airline} />
          {detail.flightNumber && <DetailRow label="Flight" value={detail.flightNumber} />}
          {detail.pnr && <DetailRow label="PNR" value={detail.pnr} />}
          {detail.originAirportCode && detail.destinationAirportCode && (
            <DetailRow label="Route" value={`${detail.originAirportCode} → ${detail.destinationAirportCode}`} />
          )}
          {detail.departureAt && <DetailRow label="Departs" value={formatDate(detail.departureAt)} />}
          <DetailRow label="Arrives with group" value={detail.arrivesWithGroup ? "Yes" : "No"} />
        </div>
      );

    case "LAND_ONLY":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="Replaces" value={`${detail.replacesFlightIds.length} flight(s)`} />
          {detail.note && <DetailRow label="Note" value={detail.note} />}
        </div>
      );

    case "CABIN_UPGRADE":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="From" value={detail.fromCabin} />
          <DetailRow label="To" value={detail.toCabin} />
          {detail.pnr && <DetailRow label="PNR" value={detail.pnr} />}
        </div>
      );

    case "SEAT_PREFERENCE":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="Preference" value={detail.preference.replace(/_/g, " ").toLowerCase()} />
          {detail.note && <DetailRow label="Note" value={detail.note} />}
        </div>
      );

    case "EXTENDED_STAY":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="New return" value={formatDate(detail.newReturnDate)} />
          <DetailRow label="Arrangement" value={detail.onwardArrangement} />
        </div>
      );

    case "ITINERARY_OPT_OUT":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="Days opted out" value={String(detail.itineraryItemIds.length)} />
          {detail.reason && <DetailRow label="Reason" value={detail.reason} />}
        </div>
      );

    case "ITINERARY_ADDITION":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="Activity" value={detail.title} />
          {detail.dayNumber && <DetailRow label="Day" value={String(detail.dayNumber)} />}
          <DetailRow label="Location" value={detail.location} />
          {detail.supplierName && <DetailRow label="Supplier" value={detail.supplierName} />}
        </div>
      );

    case "SERVICE_ADDON":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {detail.addonCode && <DetailRow label="Add-on" value={detail.addonCode} />}
          <DetailRow label="Qty" value={String(detail.quantity)} />
          {detail.note && <DetailRow label="Note" value={detail.note} />}
        </div>
      );

    case "PRIVATE_TRANSFER":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="Route" value={detail.route} />
          <DetailRow label="Vehicle" value={detail.vehicleType.toLowerCase()} />
          {detail.pickupAt && <DetailRow label="Pickup" value={formatDate(detail.pickupAt)} />}
        </div>
      );

    case "PICKUP_POINT":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="Pickup" value={detail.pickupLocation} />
          {detail.pickupAt && <DetailRow label="Time" value={formatDate(detail.pickupAt)} />}
        </div>
      );

    case "DOCUMENT_REQUIREMENT":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="Document" value={detail.documentName} />
          <DetailRow label="Required by" value={detail.requiredByStage.replace(/_/g, " ").toLowerCase()} />
        </div>
      );

    case "ASSISTANCE":
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <DetailRow label="Type" value={detail.assistanceType.toLowerCase()} />
          <DetailRow label="Details" value={detail.details} />
        </div>
      );

    case "OTHER":
      return <DetailRow label="Note" value={detail.note} />;

    default:
      return null;
  }
}
