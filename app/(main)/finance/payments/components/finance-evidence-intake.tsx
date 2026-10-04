"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { ToneBadge } from "@/components/ui/tone-badge";
import { formatExactCurrency, formatShortDate } from "@/app/(main)/departure-groups/utils";
import type { EvidenceMatchCandidate, FinanceEvidenceIntakeItem } from "@/lib/finance/evidence-matching";

import {
  dismissFinanceEvidenceAction,
  loadFinanceEvidenceIntakeAction,
  matchFinanceEvidenceAction,
} from "../actions";

type FinanceEvidenceIntakeLoad =
  | { state: "LOADING" }
  | { state: "ERROR"; message: string }
  | { state: "READY"; items: FinanceEvidenceIntakeItem[]; canDecide: boolean };

const OUTCOME_BADGE: Record<FinanceEvidenceIntakeItem["match"]["outcome"], { tone: "info" | "warning" | "neutral"; label: string }> = {
  CANDIDATES: { tone: "info", label: "Possible match found" },
  AMBIGUOUS: { tone: "warning", label: "Several equally likely matches" },
  UNMATCHED: { tone: "neutral", label: "No matching payment found" },
};

const UNMATCHED_EXPLANATION: Record<NonNullable<FinanceEvidenceIntakeItem["match"]["unmatchedReason"]>, string> = {
  NO_USABLE_EVIDENCE: "No amount or reference could be read from this receipt, so nothing can be suggested.",
  NOT_PENDING_REVIEW: "This receipt has already been reviewed.",
  NO_CANDIDATE: "No recorded payment has the same amount or reference as this receipt.",
};

function formatReceiptAmount(amount: number | null): string {
  return amount === null ? "Not read" : amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Finance's review list for receipts copied from the Inbox. Nothing here creates, verifies, or changes a payment:
 * matching links a receipt to a payment that Finance has already recorded, and dismissing closes it as not proof.
 */
export default function FinanceEvidenceIntake({ highlightEvidenceId }: { highlightEvidenceId?: string }) {
  const [load, setLoad] = useState<FinanceEvidenceIntakeLoad>({ state: "LOADING" });
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refreshFinanceEvidenceList = useCallback(() => {
    startTransition(async () => {
      const result = await loadFinanceEvidenceIntakeAction();
      setLoad(
        result.ok
          ? { state: "READY", items: result.items, canDecide: result.canDecide }
          : { state: "ERROR", message: result.error },
      );
    });
  }, []);

  useEffect(() => {
    refreshFinanceEvidenceList();
  }, [refreshFinanceEvidenceList]);

  const settleDecision = (result: { ok: true; message: string } | { ok: false; error: string }) => {
    setAnnouncement(result.ok ? result.message : result.error);
    refreshFinanceEvidenceList();
  };

  return (
    <Card className="gap-4 p-4 shadow-sm" aria-label="Receipt evidence waiting for Finance review">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Receipts waiting for Finance review</h2>
        <p className="text-xs text-muted-foreground">
          These receipts were copied from the Inbox. Details were read from the image automatically and can be wrong, so
          check the receipt before matching. Nothing here creates or verifies a payment.
        </p>
      </div>

      <p role="status" aria-live="polite" className="text-xs font-medium">
        {announcement}
      </p>

      {load.state === "LOADING" && <p className="text-sm text-muted-foreground">Loading receipts…</p>}

      {load.state === "ERROR" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive" role="alert">
            {load.message}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={refreshFinanceEvidenceList} disabled={pending}>
            Try again
          </Button>
        </div>
      )}

      {load.state === "READY" && (
        <>
          {!load.canDecide && (
            <p className="text-xs text-muted-foreground" role="note">
              You can view these receipts. Only Finance and Admin can match or dismiss them.
            </p>
          )}
          {highlightEvidenceId && !load.items.some((item) => item.id === highlightEvidenceId) && (
            <p className="text-xs text-muted-foreground" role="note">
              The receipt you opened is no longer waiting for review. It may already have been matched or dismissed.
            </p>
          )}
          {load.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No receipts are waiting for Finance review.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {load.items.map((item) => (
                <li key={item.id}>
                  <FinanceEvidenceIntakeCard
                    item={item}
                    canDecide={load.canDecide}
                    highlighted={item.id === highlightEvidenceId}
                    onSettled={settleDecision}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function FinanceEvidenceIntakeCard({
  item,
  canDecide,
  highlighted,
  onSettled,
}: {
  item: FinanceEvidenceIntakeItem;
  canDecide: boolean;
  highlighted: boolean;
  onSettled: (result: { ok: true; message: string } | { ok: false; error: string }) => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pendingPaymentId, setPendingPaymentId] = useState<string | null>(null);
  const [dismissOpen, setDismissOpen] = useState(false);
  const badge = OUTCOME_BADGE[item.match.outcome];

  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView({ block: "center" });
  }, [highlighted]);

  const matchToPayment = async (paymentId: string) => {
    setPendingPaymentId(paymentId);
    const result = await matchFinanceEvidenceAction({ evidenceId: item.id, paymentId });
    setPendingPaymentId(null);
    onSettled(result);
  };

  return (
    <div
      ref={cardRef}
      className={`flex flex-col gap-3 rounded-lg border p-3 ${highlighted ? "border-primary ring-2 ring-primary/30" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          <dt className="text-muted-foreground">Amount on receipt</dt>
          <dd className="font-medium">{formatReceiptAmount(item.amount)}</dd>
          <dt className="text-muted-foreground">Reference on receipt</dt>
          <dd className="font-medium">{item.reference ?? "Not read"}</dd>
          <dt className="text-muted-foreground">Date on receipt</dt>
          <dd className="font-medium">{formatShortDate(item.date)}</dd>
          <dt className="text-muted-foreground">Copied to Finance</dt>
          <dd className="font-medium">{formatShortDate(item.createdAt)}</dd>
        </dl>
        <ToneBadge tone={badge.tone} label={badge.label} />
      </div>

      {item.match.outcome === "AMBIGUOUS" && (
        <p className="text-xs text-muted-foreground" role="note">
          More than one payment fits equally well. Open the receipt and choose carefully, or leave it for now.
        </p>
      )}
      {item.match.outcome === "UNMATCHED" && item.match.unmatchedReason && (
        <p className="text-xs text-muted-foreground">{UNMATCHED_EXPLANATION[item.match.unmatchedReason]}</p>
      )}

      {item.match.candidates.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Candidate payments">
          {item.match.candidates.map((candidate) => (
            <li key={candidate.paymentId}>
              <FinanceEvidenceCandidateRow
                candidate={candidate}
                canDecide={canDecide}
                busy={pendingPaymentId !== null}
                matching={pendingPaymentId === candidate.paymentId}
                onMatch={() => void matchToPayment(candidate.paymentId)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {item.sourceHref && (
          <Button size="sm" variant="outline" nativeButton={false} render={<a href={item.sourceHref} />}>
            Open the Inbox conversation
          </Button>
        )}
        {canDecide && (
          <Button type="button" size="sm" variant="outline" onClick={() => setDismissOpen(true)} disabled={pendingPaymentId !== null}>
            Dismiss receipt
          </Button>
        )}
        <span className="text-xs text-muted-foreground">Doing nothing keeps this receipt in the list.</span>
      </div>

      <FinanceEvidenceDismissDialog
        evidenceId={item.id}
        open={dismissOpen}
        onClose={() => setDismissOpen(false)}
        onSettled={onSettled}
      />
    </div>
  );
}

function FinanceEvidenceCandidateRow({
  candidate,
  canDecide,
  busy,
  matching,
  onMatch,
}: {
  candidate: EvidenceMatchCandidate;
  canDecide: boolean;
  busy: boolean;
  matching: boolean;
  onMatch: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-muted/40 p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {candidate.paymentReference} · {formatExactCurrency(candidate.amount, candidate.currency)}
        </p>
        <p className="text-xs text-muted-foreground">Recorded {formatShortDate(candidate.paidAt)}</p>
        <ToneBadge
          tone={candidate.strength === "STRONG" ? "success" : "neutral"}
          label={candidate.strength === "STRONG" ? "Strong match" : "Possible match"}
        />
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {candidate.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
      {canDecide && (
        <Button type="button" size="sm" onClick={onMatch} disabled={busy}>
          {matching ? "Matching…" : "Match to this payment"}
        </Button>
      )}
    </div>
  );
}

function FinanceEvidenceDismissDialog({
  evidenceId,
  open,
  onClose,
  onSettled,
}: {
  evidenceId: string;
  open: boolean;
  onClose: () => void;
  onSettled: (result: { ok: true; message: string } | { ok: false; error: string }) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) {
      setError("Enter a reason before dismissing this receipt.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await dismissFinanceEvidenceAction({ evidenceId, reason });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReason("");
    onClose();
    onSettled(result);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader className="gap-2">
          <DialogTitle>Dismiss this receipt?</DialogTitle>
          <DialogDescription>
            Dismissing closes the receipt as not proof of payment. No payment is created or changed, and the reason is
            kept in the Finance activity log.
          </DialogDescription>
        </DialogHeader>
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Reason for dismissing</InputGroupText>
          </InputGroupAddon>
          <InputGroupTextarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} />
        </InputGroup>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={() => void submit()} disabled={submitting}>
            {submitting ? "Dismissing…" : "Dismiss receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
