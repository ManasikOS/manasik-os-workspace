"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ArrowRightLeft, ArrowUpFromLine, Ban, Download, Eraser, FileText, Import,
  Loader2, MegaphoneIcon, MoreHorizontal, Pencil, Printer, TimerOff, Wallet, Wrench,
} from "lucide-react";

import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import { DataTable } from "@/components/data-table/data-table";
import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { capabilitiesForFinance } from "@/lib/access/finance-access";

import { promoteWaitlistAction, releaseExpiredHoldsAction } from "../../../actions";
import { downloadBinaryFile, downloadTextFile, timestampedFilename } from "../../../csv";
import { manifestToCsv, manifestToMatrix } from "../../../manifest";
import type {
  DepartureGroupAccommodation, DepartureGroupBooking, DepartureGroupFlight,
  DepartureGroupListItem, DepartureGroupManifestRow, DepartureGroupPackageSnapshot,
  DepartureGroupPricing, DepartureGroupTransport, GroupActivityLog,
  MoveTargetGroupOption, ServiceAddon,
} from "../../../types";
import { matrixToXlsx, XLSX_MIME } from "../../../xlsx";
import CancelBookingDialog from "../cancel-booking-dialog";
import CustomiseTravellerDialog from "../customisation/dialogs/customise-traveller-dialog";
import EraseTravellerDataDialog from "../erase-traveller-data-dialog";
import EditBookingDialog from "../edit-booking-dialog";
import ImportPilgrimsDialog from "../import-pilgrims-dialog";
import InvoicePreviewDialog from "../invoice-preview-dialog";
import MoveBookingDialog from "../move-booking-dialog";
import PilgrimCustomisationDrawer from "../pilgrim-customisation-drawer";
import RecordPaymentDialog from "../record-payment-dialog";
import SendReminderDialog, { type ReminderKind } from "../send-reminder-dialog";
import { buildDepartureBookingColumns, buildDeparturePilgrimColumns, DepartureCustomisationCountBadge } from "./pilgrims-bookings-columns";

interface PilgrimsBookingsTabProps {
  manifest: DepartureGroupManifestRow[];
  bookings: DepartureGroupBooking[];
  group: DepartureGroupListItem;
  snapshot: DepartureGroupPackageSnapshot;
  pricing: DepartureGroupPricing;
  moveTargets: MoveTargetGroupOption[];
  activity: GroupActivityLog[];
  role: StaffRole;
  flights: DepartureGroupFlight[];
  accommodations: DepartureGroupAccommodation[];
  transports: DepartureGroupTransport[];
  serviceAddons: ServiceAddon[];
}

const TABLE_CARD_CLASS = "gap-4 overflow-hidden px-0 pb-0 [&>[data-slot=card]]:rounded-none [&>[data-slot=card]]:border-x-0 [&>[data-slot=card]]:border-b-0 [&>[data-slot=card]]:shadow-none";

const PilgrimsBookingsTab = ({ manifest, bookings, group, snapshot, pricing, moveTargets, activity, role, flights, accommodations, transports, serviceAddons }: PilgrimsBookingsTabProps) => {
  const can = useDepartureCapabilities(role);
  const canInvoice = capabilitiesForFinance(role).createInvoices;
  const router = useRouter();
  const [isSeatPending, startSeatTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [bookingSearch, setBookingSearch] = useState("");
  const [paymentBookingId, setPaymentBookingId] = useState<string | null>(null);
  const [moveBookingId, setMoveBookingId] = useState<string | null>(null);
  const [customiseTravellerId, setCustomiseTravellerId] = useState<string | null>(null);
  const [reviewCustomisationsId, setReviewCustomisationsId] = useState<string | null>(null);
  const [reminder, setReminder] = useState<{ bookingId: string; kind: ReminderKind } | null>(null);
  const [cancelBookingId, setCancelBookingId] = useState<string | null>(null);
  const [eraseTraveller, setEraseTraveller] = useState<{ id: string; fullName: string } | null>(null);
  const [invoiceBookingId, setInvoiceBookingId] = useState<string | null>(null);
  const [editBookingId, setEditBookingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [mountedAt] = useState(() => Date.now());

  const bookingsById = useMemo(() => new Map(bookings.map((booking) => [booking.id, booking])), [bookings]);
  const travellersByBooking = useMemo(() => {
    const result = new Map<string, DepartureGroupManifestRow[]>();
    for (const pilgrim of manifest) result.set(pilgrim.bookingId, [...(result.get(pilgrim.bookingId) ?? []), pilgrim]);
    return result;
  }, [manifest]);
  const bookingOf = (id: string | null) => id ? (bookingsById.get(id) ?? null) : null;
  const travellersOf = (id: string | null) => id ? (travellersByBooking.get(id) ?? []) : [];

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? manifest.filter((pilgrim) => [pilgrim.fullName, pilgrim.bookingReference, pilgrim.bookingLabel, pilgrim.phone ?? ""].join(" ").toLowerCase().includes(needle)) : manifest;
  }, [manifest, search]);
  const bookingRows = useMemo(() => {
    const needle = bookingSearch.trim().toLowerCase();
    return needle ? bookings.filter((booking) => [booking.bookingReference, booking.primaryContactName, booking.primaryContactPhone].join(" ").toLowerCase().includes(needle)) : bookings;
  }, [bookingSearch, bookings]);
  const confirmedBookings = bookings.filter((booking) => booking.bookingStatus === "CONFIRMED").length;
  const waitlisted = bookings.filter((booking) => booking.bookingStatus === "WAITLIST");
  const expiredHolds = bookings.filter((booking) => booking.bookingStatus === "HELD" && booking.seatHoldExpiresAt !== null && Date.parse(booking.seatHoldExpiresAt) < mountedAt && booking.amountPaid <= 0).length;

  const openBooking = (bookingId: string) => router.push(`/departure-groups/${group.id}/bookings/${bookingId}`);
  const openIdCardStudio = (pilgrimId: string) => router.push(`/departure-groups/${group.id}/pilgrims/${pilgrimId}/id-card`);
  const releaseHolds = () => startSeatTransition(async () => {
    const result = await releaseExpiredHoldsAction({ departureGroupId: group.id });
    if (!result.ok) return void toast.add({ title: "Could not release holds", description: result.error });
    toast.add({ title: "Expired holds released", description: `${result.releasedSeats} seat${result.releasedSeats === 1 ? "" : "s"} returned to the group.` });
  });
  const promoteWaitlist = () => startSeatTransition(async () => {
    const result = await promoteWaitlistAction({ departureGroupId: group.id });
    if (!result.ok) return void toast.add({ title: "Could not promote", description: result.error });
    toast.add({ title: "Promoted from waitlist", description: `${result.bookingReference} (${result.primaryContactName}) now holds ${result.travellerCount} seat${result.travellerCount === 1 ? "" : "s"}.` });
  });
  const exportManifest = (format: "csv" | "xlsx") => {
    if (!rows.length) return void toast.add({ title: "Nothing to export", description: search.trim() ? "No pilgrims match the current search." : "This group has no pilgrims yet." });
    const prefix = `${group.groupCode}-manifest`;
    if (format === "xlsx") downloadBinaryFile(timestampedFilename(prefix, "xlsx"), matrixToXlsx(manifestToMatrix(rows, bookings, can), "Manifest"), XLSX_MIME);
    else downloadTextFile(timestampedFilename(prefix), manifestToCsv(rows, bookings, can));
    toast.add({ title: "Export ready", description: `${rows.length}${rows.length === manifest.length ? "" : ` of ${manifest.length}`} pilgrim${rows.length === 1 ? "" : "s"} exported to ${format === "xlsx" ? "Excel" : "CSV"}.` });
  };

  const pilgrimActions = (pilgrim: DepartureGroupManifestRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger onClick={(event) => event.stopPropagation()} render={<Button variant="ghost" size="icon" aria-label={`Actions for ${pilgrim.fullName}`}><MoreHorizontal /></Button>} />
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onClick={() => openBooking(pilgrim.bookingId)}><FileText /> Open Booking</DropdownMenuItem>
        {can.viewSensitiveTravellerData && <DropdownMenuItem onClick={() => openIdCardStudio(pilgrim.id)}><Printer /> ID Card</DropdownMenuItem>}
        {pilgrim.hasCustomisations && (can.manageTravellerCustomisations || can.approveDiscounts) && <DropdownMenuItem onClick={() => setReviewCustomisationsId(pilgrim.id)}><Wrench /> Review Customisations</DropdownMenuItem>}
        {can.manageTravellerCustomisations && <DropdownMenuItem onClick={() => setCustomiseTravellerId(pilgrim.id)}><Wrench /> Customise Traveller</DropdownMenuItem>}
        {can.recordPayments && <DropdownMenuItem onClick={() => setPaymentBookingId(pilgrim.bookingId)}><Wallet /> Record Deposit</DropdownMenuItem>}
        {can.addBookings && <DropdownMenuItem onClick={() => setEditBookingId(pilgrim.bookingId)}><Pencil /> Edit Booking</DropdownMenuItem>}
        {can.editGroupDetails && <DropdownMenuItem onClick={() => setMoveBookingId(pilgrim.bookingId)}><ArrowRightLeft /> Move to Another Group</DropdownMenuItem>}
        {can.eraseTravellerData && <DropdownMenuItem variant="destructive" onClick={() => setEraseTraveller({ id: pilgrim.id, fullName: pilgrim.fullName })}><Eraser /> Erase Sensitive Details</DropdownMenuItem>}
        <DropdownMenuSeparator />
        {can.sendGroupCommunications && <DropdownMenuItem onClick={() => setReminder({ bookingId: pilgrim.bookingId, kind: "PAYMENT" })}><MegaphoneIcon /> Send Payment Reminder</DropdownMenuItem>}
        {can.sendGroupCommunications && <DropdownMenuItem onClick={() => setReminder({ bookingId: pilgrim.bookingId, kind: "DOCUMENT" })}><MegaphoneIcon /> Send Document Reminder</DropdownMenuItem>}
        {can.cancelBookings && <DropdownMenuItem variant="destructive" onClick={() => setCancelBookingId(pilgrim.bookingId)}><Ban /> Cancel Booking</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const bookingActions = (booking: DepartureGroupBooking) => (
    <DropdownMenu>
      <DropdownMenuTrigger onClick={(event) => event.stopPropagation()} render={<Button variant="ghost" size="icon" aria-label={`Actions for booking ${booking.bookingReference}`}><MoreHorizontal /></Button>} />
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onClick={() => openBooking(booking.id)}><FileText /> Open Booking</DropdownMenuItem>
        {can.addBookings && booking.bookingStatus !== "CANCELLED" && <DropdownMenuItem onClick={() => setEditBookingId(booking.id)}><Pencil /> Edit Booking</DropdownMenuItem>}
        {can.recordPayments && booking.bookingStatus !== "CANCELLED" && <DropdownMenuItem onClick={() => setPaymentBookingId(booking.id)}><Wallet /> Record Payment</DropdownMenuItem>}
        {canInvoice && booking.bookingStatus !== "CANCELLED" && <DropdownMenuItem onClick={() => setInvoiceBookingId(booking.id)}><FileText /> Generate Invoice</DropdownMenuItem>}
        {can.cancelBookings && booking.bookingStatus !== "CANCELLED" && <DropdownMenuItem variant="destructive" onClick={() => setCancelBookingId(booking.id)}><Ban /> Cancel Booking</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const pilgrimColumns = buildDeparturePilgrimColumns({
    showPricing: can.viewPilgrimPricing,
    renderActions: pilgrimActions,
    renderCustomisations: (pilgrim) => (
      can.manageTravellerCustomisations || can.approveDiscounts ?
        <button type="button" className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onClick={(event) => { event.stopPropagation(); setReviewCustomisationsId(pilgrim.id); }} aria-label={`Review customisations for ${pilgrim.fullName}`}><DepartureCustomisationCountBadge pilgrim={pilgrim} /></button> :
        <DepartureCustomisationCountBadge pilgrim={pilgrim} />
    ),
  });
  const bookingColumns = buildDepartureBookingColumns({ showFinance: can.viewFinance, renderActions: bookingActions });

  return (
    <div className="flex flex-col gap-5">
      <Card className={TABLE_CARD_CLASS}>
        <div className="px-6"><SectionHeading title="Pilgrims & Bookings" act={<div className="flex flex-wrap items-center gap-2 sm:justify-end">{can.addBookings && <Button variant="outline_without_border" onClick={() => setImportOpen(true)}><Import /> Import Pilgrims</Button>}{can.exportReports && <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline_without_border"><Download /> Export Manifest</Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => exportManifest("xlsx")}>Excel (.xlsx)</DropdownMenuItem><DropdownMenuItem onClick={() => exportManifest("csv")}>CSV (.csv)</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div>} /></div>
        <DataTable columns={pilgrimColumns} data={rows} search={search} onSearchChange={setSearch} searchPlaceholder="Search pilgrim, booking reference, family..." toolbar={<div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3 sm:gap-4"><span><strong className="text-foreground">{manifest.length}</strong> pilgrims</span><span><strong className="text-foreground">{bookings.length}</strong> bookings ({confirmedBookings} confirmed)</span><span><strong className="text-foreground">{manifest.filter((pilgrim) => pilgrim.roomAssignmentStatus !== "UNASSIGNED").length}</strong> rooms assigned</span></div>} emptyMessage={manifest.length ? "No pilgrims match this search." : "No pilgrims yet. Bookings added to this group will appear here."} onRowClick={(pilgrim) => openBooking(pilgrim.bookingId)} getRowId={(pilgrim) => pilgrim.id} rowsAreButtons rowAriaLabel={(pilgrim) => `Open booking ${pilgrim.bookingReference} for ${pilgrim.fullName}`} />
      </Card>

      <Card className={TABLE_CARD_CLASS}>
        <div className="px-6"><SectionHeading title="Bookings" act={<div className="flex flex-wrap items-center gap-2 sm:justify-end">{can.addBookings && expiredHolds > 0 && <Button variant="outline_without_border" size="sm" disabled={isSeatPending} onClick={releaseHolds}>{isSeatPending ? <Loader2 className="animate-spin" /> : <TimerOff />} Release {expiredHolds} expired hold{expiredHolds === 1 ? "" : "s"}</Button>}{can.addBookings && waitlisted.length > 0 && <Button variant="secondary" size="sm" disabled={isSeatPending || group.availableSeats <= 0} onClick={promoteWaitlist}>{isSeatPending ? <Loader2 className="animate-spin" /> : <ArrowUpFromLine />} Promote from waitlist ({waitlisted.length})</Button>}<span className="text-xs text-muted-foreground">{bookings.length} booking{bookings.length === 1 ? "" : "s"}</span></div>} /></div>
        <DataTable columns={bookingColumns} data={bookingRows} search={bookingSearch} onSearchChange={setBookingSearch} searchPlaceholder="Search booking reference or primary contact..." emptyMessage={bookings.length ? "No bookings match this search." : "No bookings yet."} onRowClick={(booking) => openBooking(booking.id)} getRowId={(booking) => booking.id} rowsAreButtons rowAriaLabel={(booking) => `Open booking ${booking.bookingReference}`} />
      </Card>

      <RecordPaymentDialog booking={bookingOf(paymentBookingId)} currency={snapshot.currency || "LKR"} open={paymentBookingId !== null} onClose={() => setPaymentBookingId(null)} />
      {(can.manageTravellerCustomisations || can.approveDiscounts) && <PilgrimCustomisationDrawer row={manifest.find((pilgrim) => pilgrim.id === reviewCustomisationsId) ?? null} departureGroupId={group.id} open={reviewCustomisationsId !== null} onClose={() => setReviewCustomisationsId(null)} flights={flights} accommodations={accommodations} transports={transports} itinerary={snapshot.itinerary} groupTravellers={manifest.map((pilgrim) => ({ id: pilgrim.id, name: pilgrim.fullName }))} addons={serviceAddons} role={role} />}
      {can.manageTravellerCustomisations && <CustomiseTravellerDialog row={manifest.find((pilgrim) => pilgrim.id === customiseTravellerId) ?? null} departureGroupId={group.id} open={customiseTravellerId !== null} onClose={() => setCustomiseTravellerId(null)} flights={flights} accommodations={accommodations} transports={transports} itinerary={snapshot.itinerary} groupTravellers={manifest.map((pilgrim) => ({ id: pilgrim.id, name: pilgrim.fullName }))} addons={serviceAddons} bookings={bookings} manifest={manifest} pricing={pricing} role={role} />}
      {can.editGroupDetails && <MoveBookingDialog booking={bookingOf(moveBookingId)} travellers={travellersOf(moveBookingId)} targets={moveTargets} role={role} open={moveBookingId !== null} onClose={() => setMoveBookingId(null)} />}
      {can.sendGroupCommunications && <SendReminderDialog kind={reminder?.kind ?? null} booking={bookingOf(reminder?.bookingId ?? null)} travellers={travellersOf(reminder?.bookingId ?? null)} group={group} activity={activity} role={role} currency={snapshot.currency || "LKR"} open={reminder !== null} onClose={() => setReminder(null)} />}
      {can.addBookings && <ImportPilgrimsDialog open={importOpen} onOpenChange={setImportOpen} group={group} pricing={pricing} existingBookingCount={bookings.length} />}
      {can.addBookings && <EditBookingDialog booking={bookingOf(editBookingId)} open={editBookingId !== null} onClose={() => setEditBookingId(null)} />}
      {can.eraseTravellerData && <EraseTravellerDataDialog traveller={eraseTraveller} departureGroupId={group.id} open={eraseTraveller !== null} onClose={() => setEraseTraveller(null)} />}
      {can.addBookings && <CancelBookingDialog booking={bookingOf(cancelBookingId)} travellers={travellersOf(cancelBookingId)} role={role} currency={snapshot.currency || "LKR"} open={cancelBookingId !== null} onClose={() => setCancelBookingId(null)} />}
      {canInvoice && <InvoicePreviewDialog booking={bookingOf(invoiceBookingId)} travellers={travellersOf(invoiceBookingId)} group={group} role={role} currency={snapshot.currency || "LKR"} open={invoiceBookingId !== null} onClose={() => setInvoiceBookingId(null)} accommodations={accommodations} flights={flights} transports={transports} serviceAddons={serviceAddons} itinerary={snapshot.itinerary} />}
    </div>
  );
};

export default PilgrimsBookingsTab;
