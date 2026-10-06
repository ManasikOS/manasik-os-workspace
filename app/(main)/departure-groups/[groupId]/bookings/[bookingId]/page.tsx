import { loadBookingDetailData } from "./load-booking-detail";
import { DepartureCapabilitiesProvider } from "@/app/(main)/departure-groups/capabilities-context";
import BookingDetailView from "./components/booking-detail-view";

/**
 * The booking's dedicated screen — booking stays a child of its departure
 * group (one booking reference is only ever meaningful inside one group's
 * manifest and pricing snapshot), but it now has its own URL instead of only
 * opening as an in-place dialog from the Pilgrims & Bookings tab. Every list
 * that used to open `BookingDetailDialog` now links here.
 *
 * `/bookings/[bookingId]` (Phase 1, P1.5) is the canonical, group-agnostic
 * entry point for anyone who only knows the booking, not its group — it
 * resolves the group id and renders this exact same view via the shared
 * `loadBookingDetailData()`. This nested route stays fully functional for
 * every existing link that already knows the group.
 */
export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ groupId: string; bookingId: string }>;
}) {
  const { groupId, bookingId } = await params;
  const data = await loadBookingDetailData(groupId, bookingId);

  const { capabilities, ...viewProps } = data;

  return (
    <DepartureCapabilitiesProvider value={capabilities}>
      <BookingDetailView {...viewProps} />
    </DepartureCapabilitiesProvider>
  );
}
