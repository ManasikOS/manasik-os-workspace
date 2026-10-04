"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import React from "react";

import { ActorChip } from "@/components/ui/copilot-mark";
import {
  BOOKING_STATUS_LABELS,
  DEVIATION_STATUS_LABELS,
  DOCUMENT_STATUS_LABELS,
  FLIGHT_PILGRIM_STATUS_LABELS,
  FLIGHT_STATUS_LABELS,
  GROUP_STATUS_LABELS,
  JOURNEY_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  READINESS_ITEM_STATUS_LABELS,
  READINESS_STATUS_LABELS,
  ROOM_STATUS_LABELS,
  SALES_STATUS_LABELS,
  SEAT_STATUS_LABELS,
  SUPPLIER_STATUS_LABELS,
  TASK_STATUS_LABELS,
  TONE_BAR,
  TONE_CLASS,
  VISA_STATUS_LABELS,
  bookingTone,
  deviationTone,
  documentTone,
  flightTone,
  groupStatusTone,
  journeyTone,
  paymentTone,
  percentTone,
  pilgrimFlightTone,
  readinessItemTone,
  readinessTone,
  roomTone,
  salesTone,
  seatTone,
  supplierTone,
  taskTone,
  visaTone,
  type Tone,
} from "../utils";
import type {
  BookingStatus,
  DepartureGroupStatus,
  DeviationStatus,
  DocumentStatus,
  FlightStatus,
  GroupJourneyType,
  GroupReadinessStatus,
  GroupSalesStatus,
  PilgrimFlightStatus,
  PilgrimPaymentStatus,
  PilgrimVisaStatus,
  ReadinessItemStatus,
  RoomStatus,
  SeatStatus,
  SupplierStatus,
  TaskStatus,
} from "../types";

/**
 * One badge shape for the whole module, matching the Leads pipeline badges:
 * soft tinted background, no border, small rounded corners. The label is always
 * rendered, so the state reads correctly without relying on colour.
 */
function ToneBadge({
  tone,
  label,
  className,
}: {
  tone: Tone;
  label: string;
  className?: string;
}) {
  return (
    <Badge
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-3 rounded-sm text-sm font-medium border-none",
        TONE_CLASS[tone],
        className,
      )}
    >
      {label}
    </Badge>
  );
}

export function JourneyTypeBadge({ value }: { value: GroupJourneyType }) {
  return (
    <ToneBadge tone={journeyTone(value)} label={JOURNEY_TYPE_LABELS[value]} />
  );
}

export function SalesStatusBadge({ value }: { value: GroupSalesStatus }) {
  return (
    <ToneBadge tone={salesTone(value)} label={SALES_STATUS_LABELS[value]} />
  );
}

export function GroupStatusBadge({ value }: { value: DepartureGroupStatus }) {
  return (
    <ToneBadge
      tone={groupStatusTone(value)}
      label={GROUP_STATUS_LABELS[value]}
    />
  );
}

export function ReadinessStatusBadge({
  value,
}: {
  value: GroupReadinessStatus;
}) {
  return (
    <ToneBadge
      tone={readinessTone(value)}
      label={READINESS_STATUS_LABELS[value]}
    />
  );
}

export function ReadinessItemStatusBadge({
  value,
}: {
  value: ReadinessItemStatus;
}) {
  return (
    <ToneBadge
      tone={readinessItemTone(value)}
      label={READINESS_ITEM_STATUS_LABELS[value]}
    />
  );
}

export function SupplierStatusBadge({ value }: { value: SupplierStatus }) {
  return (
    <ToneBadge
      tone={supplierTone(value)}
      label={SUPPLIER_STATUS_LABELS[value]}
    />
  );
}

export function FlightStatusBadge({ value }: { value: FlightStatus }) {
  return (
    <ToneBadge tone={flightTone(value)} label={FLIGHT_STATUS_LABELS[value]} />
  );
}

export function BookingStatusBadge({ value }: { value: BookingStatus }) {
  return (
    <ToneBadge tone={bookingTone(value)} label={BOOKING_STATUS_LABELS[value]} />
  );
}

export function SeatStatusBadge({ value }: { value: SeatStatus }) {
  return <ToneBadge tone={seatTone(value)} label={SEAT_STATUS_LABELS[value]} />;
}

export function DocumentStatusBadge({ value }: { value: DocumentStatus }) {
  return (
    <ToneBadge
      tone={documentTone(value)}
      label={DOCUMENT_STATUS_LABELS[value]}
    />
  );
}

export function VisaStatusBadge({ value }: { value: PilgrimVisaStatus }) {
  return <ToneBadge tone={visaTone(value)} label={VISA_STATUS_LABELS[value]} />;
}

export function PaymentStatusBadge({ value }: { value: PilgrimPaymentStatus }) {
  return (
    <ToneBadge
      tone={paymentTone(value)}
      className="w-full"
      label={PAYMENT_STATUS_LABELS[value]}
    />
  );
}

export function PilgrimFlightStatusBadge({
  value,
}: {
  value: PilgrimFlightStatus;
}) {
  return (
    <ToneBadge
      tone={pilgrimFlightTone(value)}
      label={FLIGHT_PILGRIM_STATUS_LABELS[value]}
    />
  );
}

export function RoomStatusBadge({ value }: { value: RoomStatus }) {
  return <ToneBadge tone={roomTone(value)} label={ROOM_STATUS_LABELS[value]} />;
}

export function DeviationStatusBadge({
  value,
  className,
}: {
  value: DeviationStatus;
  className?: string;
}) {
  return (
    <ToneBadge
      tone={deviationTone(value)}
      label={DEVIATION_STATUS_LABELS[value]}
      className={className}
    />
  );
}

export function TaskStatusBadge({ value }: { value: TaskStatus }) {
  return <ToneBadge tone={taskTone(value)} label={TASK_STATUS_LABELS[value]} />;
}

/** Matches the dashboard's readiness bars. */
export function ProgressBar({
  percent,
  tone,
  className,
}: {
  percent: number;
  tone?: Tone;
  className?: string;
}) {
  const resolved = tone ?? percentTone(percent);
  return (
    <div
      className={cn(
        "w-full bg-muted h-1.5 rounded-full overflow-hidden border border-muted-foreground/2",
        className,
      )}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all duration-500",
          TONE_BAR[resolved],
        )}
        style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
      />
    </div>
  );
}

/** Person chip used for guides and owners across the module. */
export function PersonChip({
  name,
  fallback = "Unassigned",
}: {
  name: string | null;
  fallback?: string;
}) {
  return <ActorChip name={name} fallback={fallback} />;
}

/** Consistent empty state for tabs and tables. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground max-w-sm">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Shown instead of a tab's contents when the role lacks the capability. */
export function PermissionDenied({ what }: { what: string }) {
  return (
    <EmptyState
      title="You do not have access to this section"
      description={`${what} is restricted to roles with the matching permission. Ask an administrator if you need access.`}
    />
  );
}
