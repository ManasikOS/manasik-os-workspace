import { notFound } from "next/navigation";

import { loadBookingDetailData, resolveGroupIdForBooking } from "@/app/(main)/departure-groups/[groupId]/bookings/[bookingId]/load-booking-detail";
import { DepartureCapabilitiesProvider } from "@/app/(main)/departure-groups/capabilities-context";
import BookingDetailView from "@/app/(main)/departure-groups/[groupId]/bookings/[bookingId]/components/booking-detail-view";

/**
 * Canonical booking detail — plan §4.5 gap 1: "renders the same detail
 * component" as the group-scoped route, reached without knowing the
 * group first. Resolves `departure_group_id` from the booking id, then
 * defers to the exact same `loadBookingDetailData()` (and so the exact
 * same access checks) the nested route uses — see that file's header for
 * why both routes stay live rather than one redirecting to the other.
 */
export const dynamic = "force-dynamic";

export default async function CanonicalBookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const groupId = await resolveGroupIdForBooking(bookingId);
  if (!groupId) notFound();

  const data = await loadBookingDetailData(groupId, bookingId);

  const { capabilities, ...viewProps } = data;

  return (
    <DepartureCapabilitiesProvider value={capabilities}>
      <BookingDetailView {...viewProps} />
    </DepartureCapabilitiesProvider>
  );
}
