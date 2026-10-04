"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import type { PortalBookingSummary } from "@/lib/data/pilgrim-portal-repository";

import { signOutPortalAction } from "../actions";

function formatDate(iso: string | null): string {
  if (!iso) return "Date to be confirmed";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default function PortalDashboardView({
  fullName,
  reference,
  bookings,
}: {
  fullName: string;
  reference: string;
  bookings: PortalBookingSummary[];
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-medium text-foreground">Welcome, {fullName}</h1>
          <p className="text-xs text-muted-foreground">{reference}</p>
        </div>
        <form action={signOutPortalAction}>
          <Button type="submit" variant="ghost" size="sm">Sign out</Button>
        </form>
      </div>

      {bookings.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">No trips are linked to your account yet.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {bookings.map((b) => (
            <Card
              key={b.bookingRowId}
              className="p-4 flex flex-col gap-2 cursor-pointer hover:bg-muted/40"
              onClick={() => router.push(`/portal/groups/${b.departureGroupId}`)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{b.groupName}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(b.departureDate)}</p>
                </div>
                <Badge variant="secondary">{b.groupStatus.replace(/_/g, " ")}</Badge>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Seat: {b.seatStatus.replace(/_/g, " ")}</span>
                <span>Visa: {b.visaStatus.replace(/_/g, " ")}</span>
                <span>Payment: {b.paymentStatus.replace(/_/g, " ")}</span>
                <span>Documents: {b.documentsCompleted}/{b.documentsRequired}</span>
              </div>
              {b.hasPublishedItinerary && (
                <p className="text-xs text-primary">Itinerary available</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
