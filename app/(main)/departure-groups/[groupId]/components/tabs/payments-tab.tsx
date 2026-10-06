"use client";

import SectionHeading from "@/components/section-heading";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import {
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  DollarSign,
  MegaphoneIcon,
  MoreHorizontal,
  Plus,
  Ticket,
  Wallet,
  Wallet2,
  WalletCards,
} from "lucide-react";
import React, { useMemo, useState } from "react";

import {
  BookingStatusBadge,
  EmptyState,
  PermissionDenied,
  ProgressBar,
} from "../../../components/status-badges";
import type {
  DepartureGroupBooking,
  DepartureGroupListItem,
  DepartureGroupManifestRow,
  DepartureGroupPricing,
  DepartureGroupPaymentSummary,
  GroupActivityLog,
} from "../../../types";
import { formatDate, formatExactCurrency } from "../../../utils";
import RecordPaymentDialog from "../record-payment-dialog";
import SelectBookingDialog from "../select-booking-dialog";
import SendReminderDialog from "../send-reminder-dialog";
import { TONE_TEXT } from "@/lib/ui/tone";

interface PaymentsTabProps {
  payments: DepartureGroupPaymentSummary | null;
  /** The ledger is booking-level: money is owed by a booking, not a pilgrim. */
  bookings: DepartureGroupBooking[];
  manifest: DepartureGroupManifestRow[];
  pricing: DepartureGroupPricing;
  group: DepartureGroupListItem;
  /** The group's trail, read to show when a booking was last chased. */
  activity: GroupActivityLog[];
  role: StaffRole;
}

function DepartureGroupPaymentMetric({
  title,
  value,
  caption,
  tone,
  icon,
}: {
  title: string;
  value: string;
  caption?: string;
  tone?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="gap-2 justify-between">
      <div>
        <div className="flex items-center gap-1.5">
          {icon && <div>{icon}</div>}
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
        </div>
        <p
          className={cn(
            "mt-2 tabular-nums text-4xl font-semibold tracking-tight",
            tone,
          )}
        >
          {value}
        </p>
      </div>
      {caption && (
        <p className="mt-2 text-xs text-muted-foreground">{caption}</p>
      )}
    </Card>
  );
}

/**
 * The group's money, read from the bookings rather than recomputed from list
 * prices: a booking carries its own agreed per-person rate, which is what was
 * actually sold, and the group's list price is only the sticker price it
 * started from. Collecting is a booking-level act, so the ledger, the row
 * actions and the reminders all key off the booking.
 */
const PaymentsTab = ({
  payments,
  bookings,
  manifest,
  pricing,
  group,
  activity,
  role,
}: PaymentsTabProps) => {
  const can = useDepartureCapabilities(role);
  const [paymentBookingId, setPaymentBookingId] = useState<string | null>(null);
  const [reminderBookingId, setReminderBookingId] = useState<string | null>(
    null,
  );
  /** Which action the booking picker is currently choosing a booking for. */
  const [picking, setPicking] = useState<"PAYMENT" | "REMINDER" | null>(null);

  const currency = pricing.currency || payments?.currency || "LKR";

  /** Cancelled bookings are history, not something to collect against. */
  const liveBookings = useMemo(
    () => bookings.filter((booking) => booking.bookingStatus !== "CANCELLED"),
    [bookings],
  );

  const bookingsById = useMemo(
    () => new Map(bookings.map((booking) => [booking.id, booking])),
    [bookings],
  );

  const travellersByBooking = useMemo(() => {
    const map = new Map<string, DepartureGroupManifestRow[]>();
    for (const row of manifest) {
      const rows = map.get(row.bookingId);
      if (rows) rows.push(row);
      else map.set(row.bookingId, [row]);
    }
    return map;
  }, [manifest]);

  /**
   * Overdue comes from the summary the server built, so the count, the money
   * and the per-row flag are all the same decision. Recomputing it here against
   * `Date.now()` would drift from the figure printed beside it and differ
   * between the server render and the client one.
   */
  const overdueBookingIds = useMemo(
    () => new Set(payments?.overdueBookingIds ?? []),
    [payments],
  );

  /** Bookings a payment or a chase can actually be aimed at. */
  const owingBookings = useMemo(
    () => liveBookings.filter((booking) => booking.outstandingBalance > 0),
    [liveBookings],
  );

  if (!payments || !can.viewFinance) {
    return (
      <Card>
        <PermissionDenied what="Group finance" />
      </Card>
    );
  }

  const collectedPercent =
    payments.expectedRevenue === 0
      ? 0
      : Math.round((payments.collectedAmount / payments.expectedRevenue) * 100);

  const overdueBookings = liveBookings.filter((booking) =>
    overdueBookingIds.has(booking.id),
  ).length;
  const owing = liveBookings.filter(
    (booking) => booking.outstandingBalance > 0,
  ).length;
  // A deposit is money actually received; a refund-pending balance is a
  // liability, so it must never be counted as a collection.
  const depositCollected = liveBookings.filter(
    (booking) => booking.amountPaid > 0,
  ).length;

  /**
   * Header actions always name their target. With one candidate that is
   * unambiguous and the picker is skipped; with several the operator chooses,
   * because "record a payment" against the wrong family is a real error and
   * guessing a default hides it.
   */
  const startAction = (kind: "PAYMENT" | "REMINDER") => {
    if (owingBookings.length === 0) {
      toast.add({
        title: "Nothing outstanding",
        description: "Every live booking on this group is paid in full.",
      });
      return;
    }
    if (owingBookings.length === 1) {
      const id = owingBookings[0].id;
      if (kind === "PAYMENT") setPaymentBookingId(id);
      else setReminderBookingId(id);
      return;
    }
    setPicking(kind);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DepartureGroupPaymentMetric
          title="Expected revenue"
          value={formatExactCurrency(payments.expectedRevenue, currency)}
          caption={`${liveBookings.length} live booking${
            liveBookings.length === 1 ? "" : "s"
          }`}
          icon={<DollarSign className="size-4 text-muted-foreground" />}
        />
        <DepartureGroupPaymentMetric
          title="Collected"
          value={formatExactCurrency(payments.collectedAmount, currency)}
          caption={`${collectedPercent}% of expected`}
          tone={TONE_TEXT.success}
          icon={<Ticket className="size-4 text-muted-foreground" />}
        />
        <DepartureGroupPaymentMetric
          title="Outstanding"
          value={formatExactCurrency(payments.outstandingAmount, currency)}
          caption={`${owing} booking${owing === 1 ? "" : "s"} still owing`}
          icon={<Wallet2 className="size-4 text-muted-foreground" />}
        />
        <DepartureGroupPaymentMetric
          title="Overdue"
          value={formatExactCurrency(payments.overdueAmount, currency)}
          caption={`${overdueBookings} booking${
            overdueBookings === 1 ? "" : "s"
          } past the due date`}
          tone={payments.overdueAmount > 0 ? "text-destructive" : undefined}
          icon={<AlertTriangle className="size-4 text-destructive" />}
        />
        <DepartureGroupPaymentMetric
          title="Refund pending"
          value={formatExactCurrency(payments.refundPendingAmount, currency)}
          caption="Owed back on cancelled bookings"
          icon={<Wallet className={`${TONE_TEXT.warning} size-4`} />}
        />
        <DepartureGroupPaymentMetric
          title="Supplier payables due"
          value={
            can.viewSupplierCosts
              ? formatExactCurrency(payments.supplierPayablesDue, currency)
              : "Restricted"
          }
          caption={
            can.viewSupplierCosts
              ? "Hotels and transport"
              : "Requires cost access"
          }
          icon={<WalletCards className="size-4 text-muted-foreground" />}
        />
      </div>

      {/* Readiness links — the money facts that gate departure. */}
      <Card className="gap-4">
        <SectionHeading
          title="Payment readiness"
          act={
            <span className="text-xs text-muted-foreground">
              Finance owner: {group.financeOwnerName ?? "Unassigned"}
            </span>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Deposit collected
            </span>
            <span className="text-sm font-number text-foreground">
              {depositCollected} / {liveBookings.length} bookings
            </span>
            <ProgressBar
              percent={
                liveBookings.length === 0
                  ? 0
                  : Math.round((depositCollected / liveBookings.length) * 100)
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Not yet paid in full
            </span>
            <span className="text-sm font-number text-foreground">{owing}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Overdue balances
            </span>
            <span
              className={cn(
                "text-sm font-number",
                overdueBookings > 0 ? "text-destructive" : "text-foreground",
              )}
            >
              {overdueBookings}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Advance deposit
            </span>
            <span className="text-sm font-number text-foreground">
              {pricing.advanceDeposit === null
                ? "—"
                : formatExactCurrency(pricing.advanceDeposit, currency)}
            </span>
          </div>
        </div>
      </Card>

      <Card className="gap-4">
        <SectionHeading
          title="Payment ledger"
          act={
            <div className="flex flex-wrap items-center gap-2">
              {can.recordPayments && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => startAction("PAYMENT")}
                >
                  <Plus /> Record Payment
                </Button>
              )}
              {can.sendGroupCommunications && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startAction("REMINDER")}
                >
                  <MegaphoneIcon /> Send Reminder
                </Button>
              )}
            </div>
          }
        />

        {bookings.length === 0 ? (
          <EmptyState title="No bookings to collect against yet" />
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {[
                    "Booking",
                    "Travellers",
                    "Avg / traveller",
                    "Total value",
                    "Paid",
                    "Balance",
                    "Next due",
                    "Status",
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
                {bookings.map((booking) => {
                  const overdue =
                    booking.bookingStatus !== "CANCELLED" &&
                    overdueBookingIds.has(booking.id);

                  return (
                    <TableRow key={booking.id} className="hover:bg-muted/50">
                      <TableCell className="px-3 py-2.5 text-sm text-foreground">
                        {booking.primaryContactName}
                        <span className="block text-[11px] text-muted-foreground font-number">
                          {booking.bookingReference}
                        </span>
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-xs font-number text-foreground">
                        {booking.travellerCount}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-xs font-number text-foreground">
                        {formatExactCurrency(
                          booking.packagePricePerPerson,
                          currency,
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-xs font-number text-foreground">
                        {formatExactCurrency(
                          booking.totalBookingValue,
                          currency,
                        )}
                      </TableCell>
                      <TableCell
                        className={`px-3 py-2.5 text-xs font-number ${TONE_TEXT.success}`}
                      >
                        {formatExactCurrency(booking.amountPaid, currency)}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-xs font-number">
                        <span
                          className={
                            booking.outstandingBalance > 0
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }
                        >
                          {formatExactCurrency(
                            booking.outstandingBalance,
                            currency,
                          )}
                        </span>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "px-3 py-2.5 text-xs",
                          overdue
                            ? "text-destructive font-medium"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatDate(booking.nextDueAt)}
                        {overdue && (
                          <span className="block text-[10px]">Overdue</span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        <BookingStatusBadge value={booking.bookingStatus} />
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        {booking.bookingStatus !== "CANCELLED" &&
                          (can.recordPayments ||
                            can.sendGroupCommunications) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Payment actions for ${booking.bookingReference}`}
                                  >
                                    <MoreHorizontal />
                                  </Button>
                                }
                              />
                              <DropdownMenuContent align="end">
                                {can.recordPayments && (
                                  <DropdownMenuItem
                                    disabled={booking.outstandingBalance <= 0}
                                    onClick={() =>
                                      setPaymentBookingId(booking.id)
                                    }
                                  >
                                    <Wallet /> Record Payment
                                  </DropdownMenuItem>
                                )}
                                {can.sendGroupCommunications && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setReminderBookingId(booking.id)
                                    }
                                  >
                                    <MegaphoneIcon /> Send Payment Reminder
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <SelectBookingDialog
        title={
          picking === "PAYMENT"
            ? "Record a payment for which booking?"
            : "Send a reminder to which booking?"
        }
        description={`${owingBookings.length} booking${
          owingBookings.length === 1 ? " has" : "s have"
        } an outstanding balance.`}
        bookings={owingBookings}
        currency={currency}
        open={picking !== null}
        onSelect={(id) => {
          if (picking === "PAYMENT") setPaymentBookingId(id);
          else setReminderBookingId(id);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />

      {can.recordPayments && (
        <RecordPaymentDialog
          booking={
            paymentBookingId
              ? (bookingsById.get(paymentBookingId) ?? null)
              : null
          }
          currency={currency}
          open={paymentBookingId !== null}
          onClose={() => setPaymentBookingId(null)}
        />
      )}

      {can.sendGroupCommunications && (
        <SendReminderDialog
          kind={reminderBookingId ? "PAYMENT" : null}
          booking={
            reminderBookingId
              ? (bookingsById.get(reminderBookingId) ?? null)
              : null
          }
          travellers={travellersByBooking.get(reminderBookingId ?? "") ?? []}
          group={group}
          activity={activity}
          role={role}
          currency={currency}
          open={reminderBookingId !== null}
          onClose={() => setReminderBookingId(null)}
        />
      )}
    </div>
  );
};

export default PaymentsTab;
