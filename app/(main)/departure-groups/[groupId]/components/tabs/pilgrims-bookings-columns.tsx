"use client";

import type { ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Wrench } from "lucide-react";

import { header } from "@/components/data-table/sortable-header";
import { Badge } from "@/components/ui/badge";
import { TONE_TEXT } from "@/lib/ui/tone";

import {
  BookingStatusBadge,
  PaymentStatusBadge,
  ProgressBar,
  SeatStatusBadge,
  VisaStatusBadge,
} from "../../../components/status-badges";
import type {
  DepartureGroupBooking,
  DepartureGroupManifestRow,
} from "../../../types";
import {
  ROOM_TYPE_LABELS,
  formatExactCurrency,
  initialsOf,
} from "../../../utils";

const CITY_LABELS: Record<string, string> = {
  MAKKAH: "Makkah",
  MADINAH: "Madinah",
  MINA: "Mina",
  ARAFAT: "Arafat",
  OTHER: "Other",
};

export function DepartureCustomisationCountBadge({
  pilgrim,
}: {
  pilgrim: DepartureGroupManifestRow;
}) {
  const count =
    pilgrim.deviations.filter(
      (deviation) =>
        deviation.status !== "DECLINED" && deviation.status !== "CANCELLED",
    ).length +
    pilgrim.charges.filter(
      (charge) => !charge.voidedAt && charge.chargeType !== "BASE_FARE",
    ).length;

  return (
    <Badge className="w-fit bg-primary/10 text-primary">
      <Wrench /> {count || "Yes"}
    </Badge>
  );
}

export function buildDeparturePilgrimColumns({
  showPricing,
  renderActions,
  renderCustomisations,
}: {
  showPricing: boolean;
  renderActions: (pilgrim: DepartureGroupManifestRow) => ReactNode;
  renderCustomisations: (pilgrim: DepartureGroupManifestRow) => ReactNode;
}): ColumnDef<DepartureGroupManifestRow>[] {
  return [
    {
      id: "pilgrim",
      header: header("Pilgrim"),
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
            {initialsOf(row.original.fullName)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {row.original.fullName}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {row.original.passportNumber ?? row.original.phone ?? "—"}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "booking",
      header: header("Booking / Family"),
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col gap-1">
          <Badge variant="outline" className="w-fit max-w-full rounded-sm text-xs text-muted-foreground">
            <span className="truncate">{row.original.bookingReference}</span>
          </Badge>
          <span className="truncate text-[11px] text-muted-foreground">
            {row.original.bookingLabel}
          </span>
        </div>
      ),
    },
    {
      id: "roomType",
      header: header("Room Type"),
      cell: ({ row }) => ROOM_TYPE_LABELS[row.original.roomTypePreference],
    },
    {
      id: "payment",
      header: header("Payment Status"),
      cell: ({ row }) => <PaymentStatusBadge value={row.original.paymentStatus} />,
    },
    {
      id: "documents",
      header: header("Documents"),
      cell: ({ row }) => (
        <div className="flex min-w-24 flex-col gap-1">
          <span className="text-xs">
            {row.original.documentsCompleted} / {row.original.documentsRequired} complete
          </span>
          <ProgressBar percent={row.original.documentCompletionPercent} />
        </div>
      ),
    },
    {
      id: "visa",
      header: header("Visa"),
      cell: ({ row }) => <VisaStatusBadge value={row.original.visaStatus} />,
    },
    {
      id: "roomAssigned",
      header: header("Room Assigned"),
      cell: ({ row }) => {
        const rooms = row.original.roomAssignments
          .map(
            (assignment) =>
              `${CITY_LABELS[assignment.city] ?? assignment.city}: ${assignment.roomLabel}`,
          )
          .join(" · ");
        return <span className="max-w-56 whitespace-normal text-xs">{rooms || "Room unassigned"}</span>;
      },
    },
    {
      id: "seat",
      header: header("Seat Status"),
      cell: ({ row }) => <SeatStatusBadge value={row.original.seatStatus} />,
    },
    {
      id: "emergencyContact",
      header: header("Emergency Contact"),
      cell: ({ row }) => (
        <span
          className={
            row.original.emergencyContactStatus === "COMPLETE"
              ? TONE_TEXT.success
              : TONE_TEXT.warning
          }
        >
          {row.original.emergencyContactStatus === "COMPLETE"
            ? "Complete"
            : row.original.emergencyContactStatus === "INCOMPLETE"
              ? "Incomplete"
              : "Missing"}
        </span>
      ),
    },
    ...(showPricing
      ? [
          {
            id: "totalPrice",
            header: header("Total Price"),
            cell: ({ row }: { row: { original: DepartureGroupManifestRow } }) => (
              <span className="whitespace-nowrap tabular-nums">
                {formatExactCurrency(row.original.totalPrice ?? 0)}
              </span>
            ),
          } satisfies ColumnDef<DepartureGroupManifestRow>,
        ]
      : []),
    {
      id: "customised",
      header: header("Customised"),
      cell: ({ row }) =>
        row.original.hasCustomisations ? (
          renderCustomisations(row.original)
        ) : (
          <span className="text-[11px] text-muted-foreground">Standard</span>
        ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => renderActions(row.original),
    },
  ];
}

export function buildDepartureBookingColumns({
  showFinance,
  renderActions,
}: {
  showFinance: boolean;
  renderActions: (booking: DepartureGroupBooking) => ReactNode;
}): ColumnDef<DepartureGroupBooking>[] {
  const financeColumns: ColumnDef<DepartureGroupBooking>[] = showFinance
    ? [
        {
          id: "value",
          header: header("Value"),
          cell: ({ row }) => formatExactCurrency(row.original.totalBookingValue),
        },
        {
          id: "paid",
          header: header("Paid"),
          cell: ({ row }) => (
            <span className={TONE_TEXT.success}>
              {formatExactCurrency(row.original.amountPaid)}
            </span>
          ),
        },
        {
          id: "balance",
          header: header("Balance"),
          cell: ({ row }) => (
            <span className={row.original.outstandingBalance > 0 ? "text-destructive" : "text-muted-foreground"}>
              {formatExactCurrency(row.original.outstandingBalance)}
            </span>
          ),
        },
      ]
    : [];

  return [
    {
      id: "reference",
      header: header("Reference"),
      cell: ({ row }) => <span className="font-medium">{row.original.bookingReference}</span>,
    },
    {
      id: "primaryContact",
      header: header("Primary Contact"),
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate">{row.original.primaryContactName}</p>
          <p className="truncate text-[11px] tabular-nums text-muted-foreground">
            {row.original.primaryContactPhone}
          </p>
        </div>
      ),
    },
    {
      id: "travellers",
      header: header("Travellers"),
      cell: ({ row }) => row.original.travellerCount,
    },
    {
      id: "occupancy",
      header: header("Occupancy"),
      cell: ({ row }) => ROOM_TYPE_LABELS[row.original.roomOccupancyPreference],
    },
    ...financeColumns,
    {
      id: "status",
      header: header("Status"),
      cell: ({ row }) => <BookingStatusBadge value={row.original.bookingStatus} />,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => renderActions(row.original),
    },
  ];
}
