"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { ChevronDown, Search, UploadCloud, WalletCards } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useEffect, useMemo, useState } from "react";

import { colomboDayKey } from "@/lib/date";
import { PAYMENT_METHOD_LABELS } from "@/lib/data/finance-copy";
import type {
  BookingPaymentMilestoneRow,
  PaymentMethod,
} from "@/lib/types/finance";

import { getBookingMilestonesAction, recordPaymentAction } from "../actions";
import { useFinance } from "../finance-store";
import { formatDate, formatExactCurrency } from "../utils";
import { createPaymentProofUploadUrl } from "../payment-proof-storage";
import { DateTimePicker } from "@/components/date-time-picker";
import { ButtonGroup } from "@/components/ui/button-group";

interface RecordPaymentBooking {
  id: string;
  bookingReference: string;
  primaryContactName: string;
  departureGroupId: string;
  outstandingBalance: number;
  currency: string;
}

interface RecordPaymentDialogProps {
  /** Pre-filled launch point (a receivables row action). */
  booking: RecordPaymentBooking | null;
  /** Header launch — no booking chosen yet, so a picker renders first. */
  headerLaunch?: boolean;
  onClose: () => void;
}

const PAYMENT_METHODS: PaymentMethod[] = [
  "CASH",
  "BANK_TRANSFER",
  "CARD",
  "ONLINE",
  "CHEQUE",
  "OTHER",
];

export default function RecordPaymentDialog({
  booking,
  headerLaunch,
  onClose,
}: RecordPaymentDialogProps) {
  const { owingBookings } = useFinance();
  const router = useRouter();

  const open = booking !== null || headerLaunch === true;
  const [pickerSearch, setPickerSearch] = useState("");
  const [chosen, setChosen] = useState<RecordPaymentBooking | null>(booking);

  const [milestones, setMilestones] = useState<BookingPaymentMilestoneRow[]>(
    [],
  );
  const [milestonesLoadedFor, setMilestonesLoadedFor] = useState<string | null>(
    null,
  );
  const [selectedMilestoneIds, setSelectedMilestoneIds] = useState<Set<string>>(
    new Set(),
  );
  const loadingMilestones =
    chosen !== null && milestonesLoadedFor !== chosen.id;

  const [amount, setAmount] = useState<number | "">("");
  const [paidAt, setPaidAt] = useState(colomboDayKey());
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [note, setNote] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, booking?.id ?? (headerLaunch ? "header" : ""), () => {
    setChosen(booking);
    setPickerSearch("");
    setAmount("");
    setPaidAt(colomboDayKey());
    setMethod("BANK_TRANSFER");
    setReferenceNumber("");
    setNote("");
    setProofFile(null);
    setProofPath(null);
    setError(null);
    setMilestones([]);
    setMilestonesLoadedFor(null);
    setSelectedMilestoneIds(new Set());
  });

  useEffect(() => {
    if (!chosen) return;
    let cancelled = false;
    getBookingMilestonesAction(chosen.id).then((result) => {
      if (cancelled) return;
      if (result.ok)
        setMilestones(
          result.milestones.filter(
            (m) => !m.waived && m.paid_amount < m.amount,
          ),
        );
      setMilestonesLoadedFor(chosen.id);
    });
    return () => {
      cancelled = true;
    };
  }, [chosen]);

  const pickerRows = useMemo(() => {
    const needle = pickerSearch.trim().toLowerCase();
    const matched = needle
      ? owingBookings.filter((b) =>
          [b.bookingReference, b.primaryContactName]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : owingBookings;
    return [...matched].sort(
      (a, b) => b.outstandingBalance - a.outstandingBalance,
    );
  }, [owingBookings, pickerSearch]);

  const toggleMilestone = (id: string) => {
    setSelectedMilestoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Uploads straight to the private bucket with a one-shot signed URL, then
   * records the resulting object path — the same flow as
   * `pilgrim-documents-drawer.tsx`. The file never passes through a Server
   * Action body.
   */
  const uploadProof = async (file: File) => {
    if (!chosen) return;
    setUploading(true);
    setError(null);
    try {
      const uploadId = crypto.randomUUID();
      const signed = await createPaymentProofUploadUrl({
        bookingId: chosen.id,
        uploadId,
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (!signed.ok) {
        setError(signed.error);
        return;
      }

      const endpoint = `/storage/v1/object/upload/sign/payment-proofs/${signed.path}?token=${encodeURIComponent(signed.token)}`;
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}${endpoint}`,
        {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        },
      );

      if (!response.ok) {
        setError("The file could not be stored. Try again.");
        return;
      }

      setProofPath(signed.path);
      setProofFile(file);
    } catch {
      setError("The file could not be uploaded. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!chosen) return;
    if (amount === "" || amount <= 0) {
      setError("Enter a payment amount greater than zero.");
      return;
    }
    if (amount > chosen.outstandingBalance) {
      setError(
        `Payment exceeds the outstanding balance of ${formatExactCurrency(chosen.outstandingBalance, chosen.currency)}.`,
      );
      return;
    }

    const allocations = Array.from(selectedMilestoneIds).map((id) => {
      const m = milestones.find((mm) => mm.id === id)!;
      return { milestoneId: id, amount: Math.max(m.amount - m.paid_amount, 0) };
    });

    setSubmitting(true);
    setError(null);
    const result = await recordPaymentAction({
      bookingId: chosen.id,
      departureGroupId: chosen.departureGroupId,
      amount,
      paidAt: new Date(paidAt).toISOString(),
      method,
      referenceNumber: referenceNumber.trim() || undefined,
      proofPath: proofPath ?? undefined,
      allocations,
      internalNote: note.trim() || undefined,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error ?? "Could not record this payment.");
      return;
    }
    toast.add({
      title: "Payment recorded",
      description: result.paymentReference
        ? `Receipt reference ${result.paymentReference}.`
        : undefined,
    });
    onClose();
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg! gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            {/* <WalletCards className="size-5 text-primary" /> */}
            <DialogTitle>Record Payment</DialogTitle>
          </div>
          {chosen && (
            <DialogDescription>
              {chosen.primaryContactName} · {chosen.bookingReference} — balance{" "}
              {formatExactCurrency(chosen.outstandingBalance, chosen.currency)}
            </DialogDescription>
          )}
        </DialogHeader>

        {!chosen ? (
          <div className="flex flex-col gap-3">
            <InputGroup className="shadow-xs">
              <InputGroupAddon>
                <InputGroupText>
                  <Search className="size-4 text-muted-foreground" />
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search booking or customer name..."
                autoFocus
              />
            </InputGroup>
            {pickerRows.length === 0 ? (
              <EmptyState title="No bookings with an outstanding balance" />
            ) : (
              <div className="flex max-h-80 flex-col gap-1 overflow-y-auto custom-scroll">
                {pickerRows.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="flex items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-left hover:bg-muted/60 transition-colors"
                    onClick={() =>
                      setChosen({
                        id: b.id,
                        bookingReference: b.bookingReference,
                        primaryContactName: b.primaryContactName,
                        departureGroupId: b.departureGroupId,
                        outstandingBalance: b.outstandingBalance,
                        currency: "LKR",
                      })
                    }
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {b.primaryContactName}
                      </p>
                      <p className="text-[11px] text-muted-foreground tabular-nums truncate">
                        {b.bookingReference}
                      </p>
                    </div>
                    <p className="text-sm tabular-nums font-semibold text-destructive shrink-0">
                      {formatExactCurrency(b.outstandingBalance, "LKR")}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText> Amount Received *</InputGroupText>
                </InputGroupAddon>
                <ButtonGroup className="w-full px-2.5 tabular-nums">
                  <InputGroupText>LKR</InputGroupText>
                  <CurrencyInput value={amount} onValueChange={setAmount} />
                </ButtonGroup>
              </InputGroup>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <DateTimePicker
                label={"Payment Date *"}
                value={paidAt}
                onChange={setPaidAt}
              />
              <DropdownMenu>
                <DropdownMenuTrigger className={"cursor-pointer"}>
                  <InputGroup>
                    <InputGroupAddon align={"block-start"}>
                      <InputGroupText> Payment Method *</InputGroupText>
                    </InputGroupAddon>

                    <InputGroupInput
                      value={PAYMENT_METHOD_LABELS[method]}
                      id="payment-method"
                      className="cursor-pointer"
                      readOnly
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-40">
                  {PAYMENT_METHODS.map((m) => (
                    <DropdownMenuItem key={m} onClick={() => setMethod(m)}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText> Reference Number</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="Bank transfer ID / receipt number / cheque number"
              />
            </InputGroup>

            <div className="flex flex-col gap-1.5 mt-2">
              <label className="text-xs font-medium text-muted-foreground">
                Apply To
              </label>
              {loadingMilestones ? (
                <p className="text-xs text-muted-foreground">
                  Loading milestones…
                </p>
              ) : milestones.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No open milestones — the payment allocates to the oldest
                  unsettled balance automatically.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5 rounded-md border border-border/50 p-2.5">
                  {milestones.map((m) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-2.5 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedMilestoneIds.has(m.id)}
                        onCheckedChange={() => toggleMilestone(m.id)}
                      />
                      <span className="text-sm text-foreground flex-1">
                        {m.label}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatExactCurrency(
                          m.amount - m.paid_amount,
                          chosen.currency,
                        )}{" "}
                        due
                        {m.due_at ? ` · ${formatDate(m.due_at)}` : ""}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <InputGroupText>Payment Proof</InputGroupText>
              <label className="flex items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-2.5 text-xs text-muted-foreground cursor-pointer hover:bg-muted/40">
                <UploadCloud className="size-4" />
                {uploading
                  ? "Uploading…"
                  : proofFile
                    ? proofFile.name
                    : "Upload receipt / bank slip"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadProof(file);
                  }}
                />
              </label>
            </div>

            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText> Internal Note</InputGroupText>
              </InputGroupAddon>
              <InputGroupTextarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional"
                rows={2}
              />
            </InputGroup>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {chosen && (
            <Button onClick={submit} disabled={submitting || uploading}>
              {submitting ? "Saving…" : "Record Payment & Issue Receipt"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
