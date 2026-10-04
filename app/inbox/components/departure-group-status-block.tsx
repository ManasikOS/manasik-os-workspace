import { Badge } from "@/components/ui/badge";
import {
  departureGroupStatusFor,
  type DepartureGroupStatusKind,
} from "@/lib/inbox/departure-group-status";

const KIND_VARIANT: Record<
  DepartureGroupStatusKind,
  "outline" | "secondary" | "default"
> = {
  NONE: "outline",
  SEAT_HOLD: "secondary",
  RECOMMENDED: "secondary",
  PREFERENCE: "secondary",
  BOOKED: "default",
};

/**
 * One departure-group row whose label always says what kind of thing it is: not chosen, recommended by Copilot,
 * the lead's preference, or booked. The same wording is never reused for two of them.
 */
export function DepartureGroupStatusBlock({
  selectedDepartureGroupId,
  booking,
  recommended,
}: {
  selectedDepartureGroupId: string | null;
  booking: {
    id: string;
    departure_group_name: string | null;
    outstanding_balance: number | null;
    seat_hold_expires_at?: string | null;
    booking_reference: string;
    booking_status: string;
  } | null;
  recommended: { departureGroupId: string; title: string } | null;
}) {
  const status = departureGroupStatusFor({
    selectedDepartureGroupId,
    booking: booking
      ? {
          reference: booking.booking_reference,
          status: booking.booking_status,
          groupName: booking.departure_group_name,
          outstandingBalance: booking.outstanding_balance,
          holdExpiresAt: booking.seat_hold_expires_at ?? null,
        }
      : null,
    recommended,
  });

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <dt className="text-xs font-medium text-muted-foreground">
          Departure group
        </dt>
        <Badge variant={KIND_VARIANT[status.kind]}>{status.label}</Badge>
      </div>
      <dd className="wrap-break-word text-sm">{status.headline}</dd>
      {status.detail && (
        <dd className="text-xs text-muted-foreground">{status.detail}</dd>
      )}
      {booking && (
        <dd>
          <a
            href={`/bookings/${booking.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Open booking
          </a>
        </dd>
      )}
    </div>
  );
}
