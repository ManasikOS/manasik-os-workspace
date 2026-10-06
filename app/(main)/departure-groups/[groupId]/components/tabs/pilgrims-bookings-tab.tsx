"use client";

import SectionHeading from "@/components/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  capabilitiesFor,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { capabilitiesForFinance } from "@/lib/access/finance-access";
import {
  ArrowRightLeft,
  ArrowUpFromLine,
  Ban,
  Download,
  FileText,
  Import,
  Loader2,
  MegaphoneIcon,
  MoreHorizontal,
  Pencil,
  Printer,
  TimerOff,
  Wallet,
  Wrench,
} from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useMemo, useState, useTransition } from "react";

import {
  BookingStatusBadge,
  EmptyState,
  PaymentStatusBadge,
  ProgressBar,
  SeatStatusBadge,
  VisaStatusBadge,
} from "../../../components/status-badges";
import type {
  DepartureGroupAccommodation,
  DepartureGroupBooking,
  DepartureGroupFlight,
  DepartureGroupListItem,
  DepartureGroupManifestRow,
  DepartureGroupPackageSnapshot,
  DepartureGroupPricing,
  DepartureGroupTransport,
  GroupActivityLog,
  MoveTargetGroupOption,
  ServiceAddon,
} from "../../../types";
import {
  ROOM_TYPE_LABELS,
  formatExactCurrency,
  initialsOf,
} from "../../../utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";
import {
  downloadBinaryFile,
  downloadTextFile,
  timestampedFilename,
} from "../../../csv";
import {
  promoteWaitlistAction,
  releaseExpiredHoldsAction,
} from "../../../actions";
import { manifestToCsv, manifestToMatrix } from "../../../manifest";
import { matrixToXlsx, XLSX_MIME } from "../../../xlsx";
import CancelBookingDialog from "../cancel-booking-dialog";
import EditBookingDialog from "../edit-booking-dialog";
import ImportPilgrimsDialog from "../import-pilgrims-dialog";
import InvoicePreviewDialog from "../invoice-preview-dialog";
import MoveBookingDialog from "../move-booking-dialog";
import CustomiseTravellerDialog from "../customisation/dialogs/customise-traveller-dialog";
import PilgrimCustomisationDrawer from "../pilgrim-customisation-drawer";
import RecordPaymentDialog from "../record-payment-dialog";
import SendReminderDialog, { type ReminderKind } from "../send-reminder-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import SearchInput from "@/components/ui/search-input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import CopyButton from "@/components/ui/copy-button";

const CITY_LABELS: Record<string, string> = {
  MAKKAH: "Makkah",
  MADINAH: "Madinah",
  MINA: "Mina",
  ARAFAT: "Arafat",
  OTHER: "Other",
};

interface PilgrimsBookingsTabProps {
  manifest: DepartureGroupManifestRow[];
  bookings: DepartureGroupBooking[];
  group: DepartureGroupListItem;
  /** Frozen package pricing — the room tiers a booking can be moved between. */
  snapshot: DepartureGroupPackageSnapshot;
  pricing: DepartureGroupPricing;
  /** Groups a booking can be moved into. Empty for roles that cannot move one. */
  moveTargets: MoveTargetGroupOption[];
  /** The group's trail, read to show when a booking was last chased. */
  activity: GroupActivityLog[];
  role: StaffRole;
  flights: DepartureGroupFlight[];
  accommodations: DepartureGroupAccommodation[];
  transports: DepartureGroupTransport[];
  serviceAddons: ServiceAddon[];
}

const PilgrimsBookingsTab = ({
  manifest,
  bookings,
  group,
  snapshot,
  pricing,
  moveTargets,
  activity,
  role,
  flights,
  accommodations,
  transports,
  serviceAddons,
}: PilgrimsBookingsTabProps) => {
  const can = capabilitiesFor(role);
  const canInvoice = capabilitiesForFinance(role).createInvoices;
  const router = useRouter();
  const [isSeatPending, startSeatTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [paymentBookingId, setPaymentBookingId] = useState<string | null>(null);
  const [moveBookingId, setMoveBookingId] = useState<string | null>(null);
  const [customiseTravellerId, setCustomiseTravellerId] = useState<
    string | null
  >(null);
  const [reviewCustomisationsId, setReviewCustomisationsId] = useState<
    string | null
  >(null);
  const [reminder, setReminder] = useState<{
    bookingId: string;
    kind: ReminderKind;
  } | null>(null);
  const [cancelBookingId, setCancelBookingId] = useState<string | null>(null);
  const [invoiceBookingId, setInvoiceBookingId] = useState<string | null>(null);
  const [editBookingId, setEditBookingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const reminderBookingId = reminder?.bookingId ?? null;

  const bookingsById = useMemo(
    () => new Map(bookings.map((booking) => [booking.id, booking])),
    [bookings],
  );

  // Every row action opens a dialog scoped to one booking, so both lookups are
  // built once rather than per dialog.
  const travellersByBooking = useMemo(() => {
    const map = new Map<string, DepartureGroupManifestRow[]>();
    for (const row of manifest) {
      const rows = map.get(row.bookingId);
      if (rows) rows.push(row);
      else map.set(row.bookingId, [row]);
    }
    return map;
  }, [manifest]);

  const bookingOf = (id: string | null) =>
    id ? (bookingsById.get(id) ?? null) : null;
  const travellersOf = (id: string | null) =>
    id ? (travellersByBooking.get(id) ?? []) : [];

  const paymentBooking = bookingOf(paymentBookingId);
  const moveBooking = bookingOf(moveBookingId);
  const reminderBooking = bookingOf(reminderBookingId);
  const cancelBooking = bookingOf(cancelBookingId);
  const invoiceBooking = bookingOf(invoiceBookingId);
  const editBooking = bookingOf(editBookingId);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return manifest;
    return manifest.filter((row) =>
      [row.fullName, row.bookingReference, row.bookingLabel, row.phone ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [manifest, search]);

  const confirmedBookings = bookings.filter(
    (booking) => booking.bookingStatus === "CONFIRMED",
  ).length;

  const waitlisted = bookings.filter(
    (booking) => booking.bookingStatus === "WAITLIST",
  );
  /**
   * Holds whose clock has already run out. The server sweeps these anyway on
   * the next mutation; surfacing the count lets an operator reclaim the seats
   * deliberately rather than wondering why availability looks wrong.
   *
   * The clock is read once per mount rather than during render — a component
   * that re-rendered on a different "now" would flicker the count, and the
   * React Compiler refuses impure calls in render for exactly that reason.
   */
  const [mountedAt] = useState(() => Date.now());
  const expiredHolds = bookings.filter(
    (booking) =>
      booking.bookingStatus === "HELD" &&
      booking.seatHoldExpiresAt !== null &&
      Date.parse(booking.seatHoldExpiresAt) < mountedAt &&
      booking.amountPaid <= 0,
  ).length;

  const releaseHolds = () => {
    startSeatTransition(async () => {
      const result = await releaseExpiredHoldsAction({
        departureGroupId: group.id,
      });
      if (!result.ok) {
        toast.add({
          title: "Could not release holds",
          description: result.error,
        });
        return;
      }
      toast.add({
        title: "Expired holds released",
        description: `${result.releasedSeats} seat${
          result.releasedSeats === 1 ? "" : "s"
        } returned to the group.`,
      });
    });
  };

  const promoteWaitlist = () => {
    startSeatTransition(async () => {
      const result = await promoteWaitlistAction({
        departureGroupId: group.id,
      });
      if (!result.ok) {
        toast.add({ title: "Could not promote", description: result.error });
        return;
      }
      toast.add({
        title: "Promoted from waitlist",
        description: `${result.bookingReference} (${result.primaryContactName}) now holds ${result.travellerCount} seat${
          result.travellerCount === 1 ? "" : "s"
        }.`,
      });
    });
  };

  /** Opens the ID card studio — an ordinary page inside the app, where the
   *  card is designed and then printed from. */
  const openIdCardStudio = (pilgrimId: string) => {
    router.push(`/departure-groups/${group.id}/pilgrims/${pilgrimId}/id-card`);
  };

  /**
   * Exports exactly what is on screen — the search filter included — so the file
   * matches what the operator is looking at. Nothing leaves the browser: the
   * workbook is built from data the page already holds, and the columns a role
   * may not see were never sent to it.
   */
  const exportManifest = (format: "csv" | "xlsx") => {
    if (rows.length === 0) {
      toast.add({
        title: "Nothing to export",
        description: search.trim()
          ? "No pilgrims match the current search."
          : "This group has no pilgrims yet.",
      });
      return;
    }

    const prefix = `${group.groupCode}-manifest`;
    if (format === "xlsx") {
      downloadBinaryFile(
        timestampedFilename(prefix, "xlsx"),
        matrixToXlsx(manifestToMatrix(rows, bookings, can), "Manifest"),
        XLSX_MIME,
      );
    } else {
      downloadTextFile(
        timestampedFilename(prefix),
        manifestToCsv(rows, bookings, can),
      );
    }

    toast.add({
      title: "Export ready",
      description: `${rows.length}${
        rows.length === manifest.length ? "" : ` of ${manifest.length}`
      } pilgrim${rows.length === 1 ? "" : "s"} exported to ${
        format === "xlsx" ? "Excel" : "CSV"
      }.`,
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <Card className="gap-4">
        <SectionHeading
          title="Pilgrims & Bookings"
          act={
            <div className="flex flex-wrap items-center gap-2">
              {can.addBookings && (
                <Button
                  variant="outline_without_border"
                  onClick={() => setImportOpen(true)}
                >
                  <Import /> Import Pilgrims
                </Button>
              )}
              {can.exportReports && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline_without_border">
                        <Download /> Export Manifest
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => exportManifest("xlsx")}>
                      Excel (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportManifest("csv")}>
                      CSV (.csv)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          }
        />

        <div className="flex justify-between items-center">
          <div className="min-w-100 max-w-100">
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
              }}
              placeholder="Search pilgrim, booking reference, family..."
            />
          </div>
          <div className="flex flex-row w-fit items-center gap-6 text-xs text-muted-foreground">
            <span className="flex text-[15px] items-center gap-1">
              <p className="font-semibold text-foreground">
                {" "}
                {manifest.length}
              </p>
              pilgrims
            </span>
            <span className="flex text-[15px] items-center gap-1">
              <p className="font-semibold text-foreground">{bookings.length}</p>
              bookings ({confirmedBookings} confirmed)
            </span>
            <span className="flex text-[15px] items-center gap-1">
              <p className="font-semibold text-foreground">
                {
                  manifest.filter(
                    (r) => r.roomAssignmentStatus !== "UNASSIGNED",
                  ).length
                }
              </p>{" "}
              rooms assigned
            </span>
          </div>
        </div>

        <div className="mt-2">
          {rows.length === 0 ? (
            <EmptyState
              title={
                manifest.length === 0
                  ? "No pilgrims on this group yet"
                  : "No pilgrims match that search"
              }
              description={
                manifest.length === 0
                  ? "Bookings created against this group will populate the manifest automatically."
                  : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto no-scrollbar">
              <Table className="w-full text-left">
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {[
                      "Pilgrim",
                      "Booking / Family",
                      "Room Type",
                      "Payment Status",
                      "Documents",
                      "Visa",
                      "Room Assigned",
                      "Seat Status",
                      "Emergency Contact",
                      ...(can.viewPilgrimPricing ? ["Total Price"] : []),
                      "Customised",
                      "",
                    ].map((label) => (
                      <TableHead
                        key={label}
                        className="h-10 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap"
                      >
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {rows.map((row) => (
                    <ContextMenu key={row.id}>
                      <ContextMenuTrigger
                        key={row.id}
                        render={
                          <TableRow
                            key={row.id}
                            className="hover:bg-muted/50"
                          />
                        }
                      >
                        <TableCell className="px-3 py-5">
                          <div className="flex items-center gap-2.5">
                            <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                              {initialsOf(row.fullName)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {row.fullName}
                              </p>
                              <p className="text-[11px] text-muted-foreground ">
                                {row.passportNumber ?? row.phone ?? "—"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge
                                  variant="outline"
                                  className="text-xs rounded-sm text-muted-foreground w-fit"
                                >
                                  {row.bookingReference}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                Copy Booking ID{" "}
                                <CopyButton textToCopy={row.bookingReference} />
                              </TooltipContent>
                            </Tooltip>
                            <span className="text-[11px] text-muted-foreground">
                              {row.bookingLabel}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-3 text-xs text-foreground">
                          {ROOM_TYPE_LABELS[row.roomTypePreference]}
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            <Tooltip>
                              <TooltipTrigger
                                className={"justify-center w-full flex"}
                              >
                                <PaymentStatusBadge value={row.paymentStatus} />
                              </TooltipTrigger>

                              {can.viewFinance &&
                                row.outstandingBalance > 0 && (
                                  <TooltipContent>
                                    <span className="text-sm font-">
                                      {formatExactCurrency(
                                        row.outstandingBalance,
                                      )}{" "}
                                      due
                                    </span>
                                  </TooltipContent>
                                )}
                            </Tooltip>
                          </div>
                        </TableCell>
                        <TableCell className="px-5 py-3">
                          <div className="flex flex-col gap-1 min-w-24">
                            <span className="text-sm text-foreground">
                              {row.documentsCompleted} / {row.documentsRequired}{" "}
                              complete
                            </span>
                            <ProgressBar
                              percent={row.documentCompletionPercent}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <VisaStatusBadge value={row.visaStatus} />
                        </TableCell>
                        <TableCell className="px-3 py-3 text-xs">
                          {row.roomAssignments.length > 0 ? (
                            <span className="text-foreground font-number">
                              {row.roomAssignments
                                .map(
                                  (a) =>
                                    `${CITY_LABELS[a.city] ?? a.city}: ${a.roomLabel}`,
                                )
                                .join(" · ")}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              Room unassigned
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <SeatStatusBadge value={row.seatStatus} />
                        </TableCell>
                        <TableCell className="px-3 py-3 text-xs">
                          <span
                            className={
                              row.emergencyContactStatus === "COMPLETE"
                                ? TONE_TEXT.success
                                : TONE_TEXT.warning
                            }
                          >
                            {row.emergencyContactStatus === "COMPLETE"
                              ? "Complete"
                              : row.emergencyContactStatus === "INCOMPLETE"
                                ? "Incomplete"
                                : "Missing"}
                          </span>
                        </TableCell>
                        {can.viewPilgrimPricing && (
                          <TableCell className="px-3 py-3 text-xs font-number text-foreground whitespace-nowrap">
                            {formatExactCurrency(row.totalPrice ?? 0)}
                          </TableCell>
                        )}
                        <TableCell className="px-3 py-3">
                          {row.hasCustomisations ? (
                            <Badge
                              className={
                                "bg-primary/10 text-primary text-[10px] w-fit" +
                                (can.manageTravellerCustomisations ||
                                can.approveDiscounts
                                  ? " cursor-pointer hover:bg-primary/20"
                                  : "")
                              }
                              onClick={(event) => {
                                if (
                                  !can.manageTravellerCustomisations &&
                                  !can.approveDiscounts
                                )
                                  return;
                                event.stopPropagation();
                                setReviewCustomisationsId(row.id);
                              }}
                            >
                              <Wrench className="size-3" />{" "}
                              {row.deviations.filter(
                                (d) =>
                                  d.status !== "DECLINED" &&
                                  d.status !== "CANCELLED",
                              ).length +
                                row.charges.filter(
                                  (c) =>
                                    !c.voidedAt && c.chargeType !== "BASE_FARE",
                                ).length || "Yes"}
                            </Badge>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              Standard
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Actions for ${row.fullName}`}
                                >
                                  <MoreHorizontal />
                                </Button>
                              }
                            />
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => router.push(`/departure-groups/${group.id}/bookings/${row.bookingId}`)}
                              >
                                <FileText /> Open Booking
                              </DropdownMenuItem>

                              {can.viewSensitiveTravellerData && (
                                <DropdownMenuItem
                                  onClick={() => openIdCardStudio(row.id)}
                                >
                                  <Printer /> ID Card
                                </DropdownMenuItem>
                              )}

                              {row.hasCustomisations &&
                                (can.manageTravellerCustomisations ||
                                  can.approveDiscounts) && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setReviewCustomisationsId(row.id)
                                    }
                                  >
                                    <Wrench /> Review Customisations
                                  </DropdownMenuItem>
                                )}

                              {can.manageTravellerCustomisations && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setCustomiseTravellerId(row.id)
                                  }
                                >
                                  <Wrench /> Customise Traveller
                                </DropdownMenuItem>
                              )}
                              {can.recordPayments && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setPaymentBookingId(row.bookingId)
                                  }
                                >
                                  <Wallet /> Record Deposit
                                </DropdownMenuItem>
                              )}

                              {can.addBookings && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setEditBookingId(row.bookingId)
                                  }
                                >
                                  <Pencil /> Edit Booking
                                </DropdownMenuItem>
                              )}
                              {can.editGroupDetails && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setMoveBookingId(row.bookingId)
                                  }
                                >
                                  <ArrowRightLeft /> Move to Another Group
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {can.sendGroupCommunications && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setReminder({
                                      bookingId: row.bookingId,
                                      kind: "PAYMENT",
                                    })
                                  }
                                >
                                  <MegaphoneIcon /> Send Payment Reminder
                                </DropdownMenuItem>
                              )}
                              {can.sendGroupCommunications && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setReminder({
                                      bookingId: row.bookingId,
                                      kind: "DOCUMENT",
                                    })
                                  }
                                >
                                  <MegaphoneIcon /> Send Document Reminder
                                </DropdownMenuItem>
                              )}
                              {can.cancelBookings && (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() =>
                                    setCancelBookingId(row.bookingId)
                                  }
                                >
                                  <Ban /> Cancel Booking
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </ContextMenuTrigger>

                      <ContextMenuContent>
                        <ContextMenuItem
                          onClick={() => router.push(`/departure-groups/${group.id}/bookings/${row.bookingId}`)}
                        >
                          <FileText /> Open Booking
                        </ContextMenuItem>
                        {can.viewSensitiveTravellerData && (
                          <ContextMenuItem
                            onClick={() => openIdCardStudio(row.id)}
                          >
                            <Printer /> ID Card
                          </ContextMenuItem>
                        )}
                        {can.manageTravellerCustomisations && (
                          <ContextMenuItem
                            onClick={() => setCustomiseTravellerId(row.id)}
                          >
                            <Wrench /> Customise Traveller
                          </ContextMenuItem>
                        )}
                        {can.recordPayments && (
                          <ContextMenuItem
                            onClick={() => setPaymentBookingId(row.bookingId)}
                          >
                            <Wallet /> Record Deposit
                          </ContextMenuItem>
                        )}

                        {can.addBookings && (
                          <ContextMenuItem
                            onClick={() => setEditBookingId(row.bookingId)}
                          >
                            <Pencil /> Edit Booking
                          </ContextMenuItem>
                        )}
                        {can.editGroupDetails && (
                          <ContextMenuItem
                            onClick={() => setMoveBookingId(row.bookingId)}
                          >
                            <ArrowRightLeft /> Move to Another Group
                          </ContextMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        {can.sendGroupCommunications && (
                          <ContextMenuItem
                            onClick={() =>
                              setReminder({
                                bookingId: row.bookingId,
                                kind: "PAYMENT",
                              })
                            }
                          >
                            <MegaphoneIcon /> Send Payment Reminder
                          </ContextMenuItem>
                        )}
                        {can.sendGroupCommunications && (
                          <ContextMenuItem
                            onClick={() =>
                              setReminder({
                                bookingId: row.bookingId,
                                kind: "DOCUMENT",
                              })
                            }
                          >
                            <MegaphoneIcon /> Send Document Reminder
                          </ContextMenuItem>
                        )}
                        {can.cancelBookings && (
                          <ContextMenuItem
                            variant="destructive"
                            onClick={() => setCancelBookingId(row.bookingId)}
                          >
                            <Ban /> Cancel Booking
                          </ContextMenuItem>
                        )}
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </Card>

      {/* Booking-level roll-up. The lifecycle a booking travels through is
          Lead → package → group → capacity check → seat hold → booking →
          pilgrim records → payment milestones → document checklist. */}
      <Card className="gap-4">
        <SectionHeading
          title="Bookings"
          act={
            <div className="flex flex-wrap items-center gap-2">
              {/* Seats behind an expired hold and the people waiting for them
                  were both invisible before: the expiry was written and never
                  swept, and a waitlisted booking had no path to a real seat. */}
              {can.addBookings && expiredHolds > 0 && (
                <Button
                  variant="outline_without_border"
                  size="sm"
                  disabled={isSeatPending}
                  onClick={releaseHolds}
                >
                  {isSeatPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <TimerOff />
                  )}
                  Release {expiredHolds} expired hold
                  {expiredHolds === 1 ? "" : "s"}
                </Button>
              )}
              {can.addBookings && waitlisted.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isSeatPending || group.availableSeats <= 0}
                  onClick={promoteWaitlist}
                  title={
                    group.availableSeats <= 0
                      ? "No free seat to promote into"
                      : undefined
                  }
                >
                  {isSeatPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ArrowUpFromLine />
                  )}
                  Promote from waitlist ({waitlisted.length})
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                {bookings.length} booking{bookings.length === 1 ? "" : "s"}
              </span>
            </div>
          }
        />
        {bookings.length === 0 ? (
          <EmptyState title="No bookings yet" />
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {[
                    "Reference",
                    "Primary contact",
                    "Travellers",
                    "Occupancy",
                    ...(can.viewFinance ? ["Value", "Paid", "Balance"] : []),
                    "Status",
                  ].map((label) => (
                    <TableHead
                      key={label}
                      className="h-10 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap"
                    >
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {bookings.map((booking) => (
                  <ContextMenu key={booking.id}>
                    <ContextMenuTrigger
                      key={booking.id}
                      render={
                        <TableRow
                          className="hover:bg-muted/50 cursor-pointer"
                          onClick={() => router.push(`/departure-groups/${group.id}/bookings/${booking.id}`)}
                        />
                      }
                    >
                      <TableCell className="px-3 py-3 text-sm text-foreground">
                        {booking.bookingReference}
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <p className="text-sm text-foreground">
                          {booking.primaryContactName}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-number">
                          {booking.primaryContactPhone}
                        </p>
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                        {booking.travellerCount}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-foreground">
                        {ROOM_TYPE_LABELS[booking.roomOccupancyPreference]}
                      </TableCell>
                      {can.viewFinance && (
                        <>
                          <TableCell className="px-3 py-3 text-sm text-foreground">
                            {formatExactCurrency(booking.totalBookingValue)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "px-3 py-3 text-sm",
                              TONE_TEXT.success,
                            )}
                          >
                            {formatExactCurrency(booking.amountPaid)}
                          </TableCell>
                          <TableCell className="px-3 py-3 text-sm">
                            <span
                              className={
                                booking.outstandingBalance > 0
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                              }
                            >
                              {formatExactCurrency(booking.outstandingBalance)}
                            </span>
                          </TableCell>
                        </>
                      )}
                      <TableCell className="px-3 py-3">
                        <BookingStatusBadge value={booking.bookingStatus} />
                      </TableCell>
                    </ContextMenuTrigger>

                    <ContextMenuContent>
                      <ContextMenuItem
                        onClick={() => router.push(`/departure-groups/${group.id}/bookings/${booking.id}`)}
                      >
                        <FileText /> Open Booking
                      </ContextMenuItem>
                      {can.addBookings &&
                        booking.bookingStatus !== "CANCELLED" && (
                          <ContextMenuItem
                            onClick={() => setEditBookingId(booking.id)}
                          >
                            <Pencil /> Edit Booking
                          </ContextMenuItem>
                        )}
                      {can.recordPayments &&
                        booking.bookingStatus !== "CANCELLED" && (
                          <ContextMenuItem
                            onClick={() => setPaymentBookingId(booking.id)}
                          >
                            <Wallet /> Record Payment
                          </ContextMenuItem>
                        )}
                      {canInvoice && booking.bookingStatus !== "CANCELLED" && (
                        <ContextMenuItem
                          onClick={() => setInvoiceBookingId(booking.id)}
                        >
                          <FileText /> Generate Invoice
                        </ContextMenuItem>
                      )}
                      {can.cancelBookings &&
                        booking.bookingStatus !== "CANCELLED" && (
                          <ContextMenuItem
                            variant="destructive"
                            onClick={() => setCancelBookingId(booking.id)}
                          >
                            <Ban /> Cancel Booking
                          </ContextMenuItem>
                        )}
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <RecordPaymentDialog
        booking={paymentBooking}
        currency={snapshot.currency || "LKR"}
        open={paymentBookingId !== null}
        onClose={() => setPaymentBookingId(null)}
      />

      {(can.manageTravellerCustomisations || can.approveDiscounts) && (
        <PilgrimCustomisationDrawer
          row={manifest.find((r) => r.id === reviewCustomisationsId) ?? null}
          departureGroupId={group.id}
          open={reviewCustomisationsId !== null}
          onClose={() => setReviewCustomisationsId(null)}
          flights={flights}
          accommodations={accommodations}
          transports={transports}
          itinerary={snapshot.itinerary}
          groupTravellers={manifest.map((r) => ({
            id: r.id,
            name: r.fullName,
          }))}
          addons={serviceAddons}
          role={role}
        />
      )}

      {can.manageTravellerCustomisations && (
        <CustomiseTravellerDialog
          row={manifest.find((r) => r.id === customiseTravellerId) ?? null}
          departureGroupId={group.id}
          open={customiseTravellerId !== null}
          onClose={() => setCustomiseTravellerId(null)}
          flights={flights}
          accommodations={accommodations}
          transports={transports}
          itinerary={snapshot.itinerary}
          groupTravellers={manifest.map((r) => ({
            id: r.id,
            name: r.fullName,
          }))}
          addons={serviceAddons}
          bookings={bookings}
          manifest={manifest}
          pricing={pricing}
          role={role}
        />
      )}

      {can.editGroupDetails && (
        <MoveBookingDialog
          booking={moveBooking}
          travellers={travellersOf(moveBookingId)}
          targets={moveTargets}
          role={role}
          open={moveBookingId !== null}
          onClose={() => setMoveBookingId(null)}
        />
      )}

      {can.sendGroupCommunications && (
        <SendReminderDialog
          kind={reminder?.kind ?? null}
          booking={reminderBooking}
          travellers={travellersOf(reminderBookingId)}
          group={group}
          activity={activity}
          role={role}
          currency={snapshot.currency || "LKR"}
          open={reminder !== null}
          onClose={() => setReminder(null)}
        />
      )}

      {can.addBookings && (
        <ImportPilgrimsDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          group={group}
          pricing={pricing}
          existingBookingCount={bookings.length}
        />
      )}

      {can.addBookings && (
        <EditBookingDialog
          booking={editBooking}
          open={editBookingId !== null}
          onClose={() => setEditBookingId(null)}
        />
      )}

      {can.addBookings && (
        <CancelBookingDialog
          booking={cancelBooking}
          travellers={travellersOf(cancelBookingId)}
          role={role}
          currency={snapshot.currency || "LKR"}
          open={cancelBookingId !== null}
          onClose={() => setCancelBookingId(null)}
        />
      )}

      {canInvoice && (
        <InvoicePreviewDialog
          booking={invoiceBooking}
          travellers={travellersOf(invoiceBookingId)}
          group={group}
          role={role}
          currency={snapshot.currency || "LKR"}
          open={invoiceBookingId !== null}
          onClose={() => setInvoiceBookingId(null)}
          accommodations={accommodations}
          flights={flights}
          transports={transports}
          serviceAddons={serviceAddons}
          itinerary={snapshot.itinerary}
        />
      )}
    </div>
  );
};

export default PilgrimsBookingsTab;
