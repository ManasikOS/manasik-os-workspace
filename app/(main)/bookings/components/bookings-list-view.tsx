"use client";

import { useMemo, useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import PageHeader from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { Tabs, TabsList, TabsTrigger } from "@/components/animate-ui/components/animate/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SearchInput from "@/components/ui/search-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/data-table/kpi-card";
import { CalendarCheck, Plus, TriangleAlert } from "lucide-react";

import { BookingStatusBadge, EmptyState } from "@/app/(main)/departure-groups/components/status-badges";
import { formatDate, formatExactCurrency } from "@/app/(main)/departure-groups/utils";
import type { DepartureGroupCapabilities } from "@/lib/access/departure-groups-access";
import type {
  CrossGroupBookingRow,
  GroupPickerOption,
} from "@/lib/data/bookings-repository";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";

type StatusFilter = "ALL" | CrossGroupBookingRow["bookingStatus"] | "AT_RISK";

const STATUS_LABELS: Record<StatusFilter, string> = {
  ALL: "All",
  HELD: "Held",
  DEPOSIT_PENDING: "Deposit Pending",
  CONFIRMED: "Confirmed",
  WAITLIST: "Waitlisted",
  CANCELLED: "Cancelled",
  AT_RISK: "Payment at Risk",
};

interface BookingsListViewProps {
  bookings: CrossGroupBookingRow[];
  groupOptions: GroupPickerOption[];
  can: DepartureGroupCapabilities;
}

export default function BookingsListView({
  bookings,
  groupOptions,
  can,
}: BookingsListViewProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");

  const [now] = useState(() => Date.now());

  const isAtRisk = (b: CrossGroupBookingRow) =>
    b.bookingStatus !== "CANCELLED" &&
    b.outstandingBalance !== null &&
    b.outstandingBalance > 0 &&
    b.nextDueAt !== null &&
    Date.parse(b.nextDueAt) < now;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return bookings.filter((b) => {
      if (status === "AT_RISK" && !isAtRisk(b)) return false;
      if (status !== "ALL" && status !== "AT_RISK" && b.bookingStatus !== status)
        return false;
      if (!needle) return true;
      return [b.bookingReference, b.primaryContactName, b.groupName, b.groupCode]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, search, status, now]);

  const confirmedCount = bookings.filter((b) => b.bookingStatus === "CONFIRMED").length;
  const atRiskCount = bookings.filter(isAtRisk).length;
  const outstandingTotal = can.viewFinance
    ? bookings.reduce((sum, b) => sum + (b.outstandingBalance ?? 0), 0)
    : 0;

  const filteredGroups = useMemo(() => {
    const needle = groupSearch.trim().toLowerCase();
    if (!needle) return groupOptions;
    return groupOptions.filter((g) =>
      [g.groupName, g.groupCode].join(" ").toLowerCase().includes(needle),
    );
  }, [groupOptions, groupSearch]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bookings"
        breadcrumb={[{ title: "Sell", link: "#" }, { title: "Bookings", link: "/bookings" }]}
        subTitle="Every booking across every departure group in one ledger. Bookings still live inside their group — open one to manage it."
        action={
          can.addBookings && (
            <Button onClick={() => setPickerOpen(true)}>
              <Plus /> New Booking
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Total bookings" value={String(bookings.length)} />
        <KpiCard title="Confirmed" value={String(confirmedCount)} />
        <KpiCard
          title="Payment at risk"
          value={String(atRiskCount)}
          desc={
            atRiskCount > 0 ? (
              <span className={cn("flex items-center gap-1", TONE_TEXT.warning)}>
                <TriangleAlert className="size-3" /> Overdue next-payment date
              </span>
            ) : undefined
          }
        />
        {can.viewFinance && (
          <KpiCard
            title="Outstanding balance"
            value={formatExactCurrency(outstandingTotal)}
          />
        )}
      </div>

      <Tabs value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
        <TabsList>
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((key) => (
            <TabsTrigger
              key={key}
              value={key}
            >
              {STATUS_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTableSurface search={search} onSearchChange={setSearch} searchPlaceholder="Search reference, contact, or group…" rowCount={filtered.length}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck className="size-8" />}
            title="No bookings found"
            description="Try a different search or filter, or create the first booking for a departure group."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {[
                  "Reference",
                  "Contact",
                  "Group",
                  "Travellers",
                  "Occupancy",
                  ...(can.viewFinance ? ["Total", "Paid", "Outstanding"] : []),
                  "Status",
                ].map((label) => (
                  <TableHead
                    key={label}
                    className="h-9 px-3 text-xs font-medium text-muted-foreground"
                  >
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/20">
              {filtered.map((b) => (
                <TableRow
                  key={b.id}
                  className="hover:bg-muted/40 cursor-pointer"
                  onClick={() => router.push(`/bookings/${b.id}`)}
                >
                  <TableCell className="px-3 py-3 text-sm text-foreground">
                    <div className="flex items-center gap-1.5">
                      {b.bookingReference}
                      {b.bookingType === "CUSTOM" && (
                        <Badge variant="secondary" className="text-[10px]">
                          Custom
                        </Badge>
                      )}
                    </div>
                    {b.payerName && (
                      <p className="text-[11px] text-muted-foreground">
                        Payer: {b.payerName}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <p className="text-sm text-foreground">{b.primaryContactName}</p>
                    <p className="text-[11px] text-muted-foreground font-number">
                      {b.primaryContactPhone}
                    </p>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">
                    {b.groupName}
                    <span className="text-muted-foreground"> · {b.groupCode}</span>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                    {b.travellerCount}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">
                    {b.roomOccupancyPreference}
                  </TableCell>
                  {can.viewFinance && (
                    <>
                      <TableCell className="px-3 py-3 text-sm text-foreground">
                        {formatExactCurrency(b.totalBookingValue ?? 0, b.currency)}
                      </TableCell>
                      <TableCell className={cn("px-3 py-3 text-sm", TONE_TEXT.success)}>
                        {formatExactCurrency(b.amountPaid ?? 0, b.currency)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-sm">
                        <span
                          className={
                            (b.outstandingBalance ?? 0) > 0
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }
                        >
                          {formatExactCurrency(b.outstandingBalance ?? 0, b.currency)}
                        </span>
                      </TableCell>
                    </>
                  )}
                  <TableCell className="px-3 py-3">
                    <BookingStatusBadge value={b.bookingStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTableSurface>

      {/* New Booking: pick which departure group it belongs to, then hand
          off to the existing Add Booking sheet on that group's own screen —
          a booking is only ever meaningful inside one group's manifest and
          pricing snapshot, so there is no group-less booking form here. */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Booking</DialogTitle>
            <DialogDescription>
              Pick the departure group this booking belongs to.
            </DialogDescription>
          </DialogHeader>
          <SearchInput
            value={groupSearch}
            onChange={setGroupSearch}
            placeholder="Search groups…"
          />
          <div className="flex flex-col gap-1 max-h-80 overflow-y-auto no-scrollbar">
            {filteredGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No open departure groups match.
              </p>
            ) : (
              filteredGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left hover:bg-muted/60 transition-colors"
                  onClick={() =>
                    router.push(`/departure-groups/${g.id}?tab=pilgrims&add=1`)
                  }
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{g.groupName}</p>
                    <p className="text-[11px] text-muted-foreground font-number">
                      {g.groupCode} · Departs {formatDate(g.departureDate)}
                    </p>
                  </div>
                  <Badge variant="secondary">{g.groupStatus}</Badge>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
