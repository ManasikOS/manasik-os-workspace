"use client";

import { Button } from "@/components/ui/button";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import { Banknote, CheckCircle2, PlusCircle, XCircle } from "lucide-react";
import React, { useState } from "react";

import { REFUND_STATUS_TONE } from "@/lib/data/finance";
import {
  REFUND_REASON_LABELS,
  REFUND_STATUS_LABELS,
} from "@/lib/data/finance-copy";
import type { FinanceRefundRequestRow } from "@/lib/types/finance";

import { useFinance } from "../../finance-store";
import { formatDateTime, formatExactCurrency } from "../../utils";
import DecideRefundDialog from "../decide-refund-dialog";
import PayRefundDialog from "../pay-refund-dialog";
import RequestRefundDialog from "../request-refund-dialog";

export default function RefundsTab() {
  const { snapshot, can } = useFinance();
  const [requestOpen, setRequestOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [decideTarget, setDecideTarget] = useState<{
    refund: FinanceRefundRequestRow;
    approve: boolean;
  } | null>(null);
  const [payTarget, setPayTarget] = useState<FinanceRefundRequestRow | null>(
    null,
  );

  const rows = snapshot.refundRequests;
  const needle = search.trim().toLowerCase();
  const filteredRows = needle
    ? rows.filter((row) =>
        [
          row.reference,
          row.primary_contact_name,
          row.booking_reference,
          row.group_name,
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : rows;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {snapshot.refundsPendingCount > 0
            ? `${snapshot.refundsPendingCount} refund request(s) totalling ${formatExactCurrency(snapshot.refundsPendingAmount, "LKR")} pending approval or payout.`
            : "No refund requests are pending."}
        </p>
        {can.requestRefunds && (
          <Button size="sm" onClick={() => setRequestOpen(true)}>
            <PlusCircle /> Request Refund
          </Button>
        )}
      </div>

      <DataTableSurface
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search refund, customer, booking, or group…"
        rowCount={filteredRows.length}
      >
        {filteredRows.length === 0 ? (
          <EmptyState
            title="No refund requests yet"
            description="A refund starts here once a booking is owed money back — from a cancellation, an overpayment, or a package change."
          />
        ) : (
          <div>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {[
                    "Reference",
                    "Customer / Booking",
                    "Group",
                    "Reason",
                    "Amount",
                    "Status",
                    "Requested",
                    "",
                  ].map((label) => (
                    <TableHead
                      key={label}
                      className="h-10 px-3 text-xs font-medium text-muted-foreground"
                    >
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {filteredRows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/50">
                    <TableCell className="px-3 py-2.5 text-sm tabular-nums text-foreground">
                      {r.reference}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm text-foreground">
                          {r.primary_contact_name}
                        </span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {r.booking_reference}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-foreground">
                      {r.group_name}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-foreground">
                      {REFUND_REASON_LABELS[r.reason]}
                      {r.reason_note && (
                        <span className="block text-[11px] text-muted-foreground">
                          {r.reason_note}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm tabular-nums text-foreground">
                      {formatExactCurrency(r.amount, r.currency)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <ToneBadge
                        tone={REFUND_STATUS_TONE[r.status]}
                        label={REFUND_STATUS_LABELS[r.status]}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                      {formatDateTime(r.requested_at)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {can.approveRefunds &&
                          r.status === "PENDING_APPROVAL" && (
                            <>
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() =>
                                  setDecideTarget({ refund: r, approve: true })
                                }
                              >
                                <CheckCircle2 className="size-3.5" /> Approve
                              </Button>
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() =>
                                  setDecideTarget({ refund: r, approve: false })
                                }
                              >
                                <XCircle className="size-3.5" /> Reject
                              </Button>
                            </>
                          )}
                        {can.approveRefunds && r.status === "APPROVED" && (
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => setPayTarget(r)}
                          >
                            <Banknote className="size-3.5" /> Pay Out
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DataTableSurface>

      <RequestRefundDialog
        booking={null}
        headerLaunch={requestOpen}
        onClose={() => setRequestOpen(false)}
      />
      <DecideRefundDialog
        request={decideTarget}
        onClose={() => setDecideTarget(null)}
      />
      <PayRefundDialog refund={payTarget} onClose={() => setPayTarget(null)} />
    </div>
  );
}
