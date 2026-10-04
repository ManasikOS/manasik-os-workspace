"use client";

import { DataTable, type DataTableSort } from "@/components/data-table/data-table";
import { SavedViewBar } from "@/components/data-table/saved-view-bar";
import { toast } from "@/components/ui/toast";
import React, { useDeferredValue, useMemo, useState } from "react";

import { PAYMENT_LEDGER_SAVED_VIEWS, type PaymentLedgerSavedView } from "@/lib/data/finance-copy";
import type { FinancePaymentRow } from "@/lib/types/finance";

import { useFinance } from "../../finance-store";
import { buildPaymentColumns } from "../../finance-table/payments-columns";
import { createPaymentProofDownloadUrl } from "../../payment-proof-storage";
import VerifyPaymentDialog from "../verify-payment-dialog";
import ReversePaymentDialog from "../reverse-payment-dialog";

function applyLedgerView(rows: FinancePaymentRow[], view: PaymentLedgerSavedView): FinancePaymentRow[] {
  const now = new Date();
  switch (view) {
    case "All":
      return rows;
    case "Today":
      return rows.filter((r) => new Date(r.paid_at).toDateString() === now.toDateString());
    case "This Month":
      return rows.filter((r) => {
        const d = new Date(r.paid_at);
        return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
      });
    case "Pending Verification":
      return rows.filter((r) => r.status === "PENDING_VERIFICATION");
    case "Unallocated":
      return rows.filter((r) => r.allocated_amount < r.amount && r.amount > 0);
    case "Reversed & Voided":
      return rows.filter((r) => r.status === "REVERSED" || r.status === "VOIDED");
    default:
      return rows;
  }
}

export default function PaymentsTab() {
  const { snapshot, can } = useFinance();

  const [view, setView] = useState<PaymentLedgerSavedView>("All");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sort, setSort] = useState<DataTableSort>({ field: "paid_at", direction: "desc" });
  const [verifyTarget, setVerifyTarget] = useState<FinancePaymentRow | null>(null);
  const [reverseTarget, setReverseTarget] = useState<FinancePaymentRow | null>(null);

  const rows = useMemo(() => {
    let result = applyLedgerView(snapshot.payments, view);
    if (deferredSearch.trim()) {
      const q = deferredSearch.trim().toLowerCase();
      result = result.filter((r) =>
        [r.payment_reference, r.booking_reference, r.primary_contact_name, r.reference_number ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return [...result].sort((a, b) => {
      const field = sort.field as keyof FinancePaymentRow;
      const av = a[field];
      const bv = b[field];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [snapshot.payments, view, deferredSearch, sort]);

  const downloadProof = async (row: FinancePaymentRow) => {
    if (!row.proof_path) return;
    const result = await createPaymentProofDownloadUrl(row.proof_path);
    if (!result.ok) {
      toast.add({ title: "Could not open proof", description: result.error });
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  const columns = useMemo(
    () =>
      buildPaymentColumns(
        {
          onVerify: setVerifyTarget,
          onReverse: setReverseTarget,
          onDownloadProof: downloadProof,
        },
        can.verifyPayments,
        can.reversePayments,
        sort,
        setSort,
      ),
    [can.verifyPayments, can.reversePayments, sort],
  );

  return (
    <div className="flex flex-col gap-4">
      <SavedViewBar views={PAYMENT_LEDGER_SAVED_VIEWS} active={view} onChange={setView} />

      <DataTable
        columns={columns}
        data={rows}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search payment ID, booking, customer, reference..."
        emptyMessage="No payments match this view."
        resetPageToken={`${view}-${deferredSearch}`}
        sort={sort}
        sortFieldByColumnId={{ id: "payment_reference", amount: "amount" }}
      />

      <VerifyPaymentDialog payment={verifyTarget} onClose={() => setVerifyTarget(null)} />
      <ReversePaymentDialog payment={reverseTarget} onClose={() => setReverseTarget(null)} />
    </div>
  );
}
