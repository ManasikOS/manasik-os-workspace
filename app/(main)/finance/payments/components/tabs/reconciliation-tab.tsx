"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import SectionHeading from "@/components/section-heading";
import { AlertTriangle, Loader2, Search, Sparkles, Undo2, Upload, X } from "lucide-react";

import {
  confirmReconciliationMatchAction,
  confirmSplitMatchAction,
  ignoreBankTransactionAction,
  importBankTransactionsAction,
  listIgnoredBankTransactionsAction,
  listReconciliationMatchesAction,
  listUnmatchedBankTransactionsAction,
  restoreBankTransactionAction,
  suggestMatchesWithAiAction,
  undoReconciliationMatchAction,
} from "../../actions";
import type { BankTransactionRow, ReconciliationMatchRow } from "@/lib/data/reconciliation-repository";
import { isReconciliationCandidatePrefillEligible, type MatchConfidence, type RankedCandidate } from "@/lib/finance/reconciliation-candidates";
import { TONE_TEXT } from "@/lib/ui/tone";
import { useFinance } from "../../finance-store";
import { formatDate, formatExactCurrency } from "../../utils";
import PeriodClosePanel from "./period-close-panel";
import ReconciliationCandidateEvidence from "../reconciliation-candidate-evidence";

const CONFIDENCE_TONE: Record<MatchConfidence, "danger" | "warning" | "info" | "success" | "neutral"> = {
  HIGH: "success",
  MEDIUM: "warning",
  LOW: "neutral",
};

/**
 * Bank / cash reconciliation (M8 of the remaining-modules plan). No live bank
 * feed exists, so a statement is imported by pasting its export (CSV, or a
 * date/description/amount table copied from a spreadsheet) rather than a
 * file upload — see `parseBankStatementCsv` for the accepted shapes. Matching
 * a line records the counterparty in `reconciliation_matches`; it does not
 * touch the payment/supplier payment itself, which is verified separately on
 * the Payments tab.
 */
export default function ReconciliationTab() {
  const { snapshot, can } = useFinance();

  const [unmatched, setUnmatched] = useState<BankTransactionRow[] | null>(null);
  const [ignored, setIgnored] = useState<BankTransactionRow[] | null>(null);
  const [matches, setMatches] = useState<ReconciliationMatchRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  const [csv, setCsv] = useState("");
  const [bankAccountLabel, setBankAccountLabel] = useState("Main");
  const [importing, setImporting] = useState(false);

  const [matchTarget, setMatchTarget] = useState<BankTransactionRow | null>(null);
  const [candidates, setCandidates] = useState<RankedCandidate[] | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [extractedPayerName, setExtractedPayerName] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [prefilledCandidateKey, setPrefilledCandidateKey] = useState<string | null>(null);

  const [splitMode, setSplitMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedAmounts, setSelectedAmounts] = useState<Record<string, string>>({});
  const [residualType, setResidualType] = useState<"" | "UNALLOCATED_CREDIT" | "BANK_CHARGE">("");
  const [residualReason, setResidualReason] = useState("");
  const [submittingSplit, setSubmittingSplit] = useState(false);

  const refresh = async () => {
    const [u, i, m] = await Promise.all([
      listUnmatchedBankTransactionsAction(),
      listIgnoredBankTransactionsAction(),
      listReconciliationMatchesAction(),
    ]);
    setUnmatched(u.ok ? u.transactions : []);
    setIgnored(i.ok ? i.transactions : []);
    setMatches(m.ok ? m.matches : []);
    setLoading(false);
  };

  useEffect(() => {
    // Fetches from the server (an external system) once the tab mounts —
    // no render-time equivalent for a Server Action call.
    if (!can.viewReconciliation) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    void refresh();
  }, [can.viewReconciliation]);

  const unallocated = useMemo(
    () => snapshot.payments.filter((p) => p.status === "COMPLETED" && p.allocated_amount < p.amount),
    [snapshot.payments],
  );
  const pendingVerification = snapshot.payments.filter((p) => p.status === "PENDING_VERIFICATION");

  const doImport = async () => {
    setImporting(true);
    const result = await importBankTransactionsAction({ bankAccountLabel, csv });
    setImporting(false);
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not import that statement" });
      return;
    }
    const notes: string[] = [];
    if (result.skippedDuplicates && result.skippedDuplicates > 0) notes.push(`${result.skippedDuplicates} exact duplicate(s) skipped`);
    if (result.flaggedPossibleDuplicates && result.flaggedPossibleDuplicates > 0)
      notes.push(`${result.flaggedPossibleDuplicates} possible duplicate(s) flagged for review`);
    toast.add({
      title: `Imported ${result.imported ?? 0} line(s)`,
      description: notes.length > 0 ? notes.join(" · ") : result.error,
    });
    setCsv("");
    refresh();
  };

  const openMatchDialog = async (transaction: BankTransactionRow) => {
    setMatchTarget(transaction);
    setCandidates(null);
    setSplitMode(false);
    setSelectedIds(new Set());
    setSelectedAmounts({});
    setResidualType("");
    setResidualReason("");
    setExtractedPayerName(null);
    setAiNote(null);
    setPrefilledCandidateKey(null);
    setLoadingCandidates(true);
    const result = await suggestMatchesWithAiAction(transaction.id);
    setLoadingCandidates(false);
    if (!result.ok) {
      toast.add({ title: result.error });
      setCandidates([]);
      return;
    }
    const rankedCandidates = result.candidates ?? [];
    setCandidates(rankedCandidates);
    const prefilled = rankedCandidates.find(isReconciliationCandidatePrefillEligible);
    setPrefilledCandidateKey(prefilled ? `${prefilled.type}:${prefilled.id}` : null);
    setExtractedPayerName(result.extractedPayerName ?? null);
    setAiNote(result.aiNote ?? null);
  };

  const confirmCandidate = async (candidate: RankedCandidate) => {
    if (!matchTarget) return;
    setConfirming(candidate.id);
    const result = await confirmReconciliationMatchAction({
      bankTransactionId: matchTarget.id,
      matchedType: candidate.type,
      matchedId: candidate.id,
      matchedAmount: candidate.amount,
      matchedLabel: candidate.label,
    });
    setConfirming(null);
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not confirm the match" });
      return;
    }
    toast.add({ title: "Matched" });
    setMatchTarget(null);
    refresh();
  };

  const toggleSelected = (candidate: RankedCandidate) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = `${candidate.type}:${candidate.id}`;
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        setSelectedAmounts((amounts) => ({ ...amounts, [key]: String(candidate.amount) }));
      }
      return next;
    });
  };

  const selectedTotal = Array.from(selectedIds).reduce((sum, key) => sum + (Number(selectedAmounts[key]) || 0), 0);
  const residualAmount = matchTarget ? Math.round((Math.abs(matchTarget.amount) - selectedTotal) * 100) / 100 : 0;

  const submitSplit = async () => {
    if (!matchTarget || !candidates) return;
    const lines = Array.from(selectedIds).map((key) => {
      const [type, id] = key.split(":") as ["PAYMENT" | "SUPPLIER_PAYMENT", string];
      const candidate = candidates.find((c) => c.type === type && c.id === id)!;
      return { targetType: type, targetId: id, amount: Number(selectedAmounts[key]) || 0, label: candidate.label };
    });
    setSubmittingSplit(true);
    const result = await confirmSplitMatchAction({
      bankTransactionId: matchTarget.id,
      lines,
      residualAmount: residualAmount !== 0 ? residualAmount : undefined,
      residualType: residualAmount !== 0 ? residualType || undefined : undefined,
      residualReason: residualAmount !== 0 ? residualReason || undefined : undefined,
    });
    setSubmittingSplit(false);
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not confirm the split match" });
      return;
    }
    toast.add({ title: "Matched" });
    setMatchTarget(null);
    refresh();
  };

  const undo = async (bankTransactionId: string) => {
    const result = await undoReconciliationMatchAction({ bankTransactionId });
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not undo the match" });
      return;
    }
    refresh();
  };

  const ignore = async (bankTransactionId: string) => {
    const result = await ignoreBankTransactionAction({ bankTransactionId });
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not ignore that line" });
      return;
    }
    refresh();
  };

  const restore = async (bankTransactionId: string) => {
    const result = await restoreBankTransactionAction({ bankTransactionId });
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not restore that line" });
      return;
    }
    refresh();
  };

  return (
    <div className="flex flex-col gap-5">
      <Card className="gap-4">
        <SectionHeading title="Payment queue" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block">Pending Verification</span>
            <span className="font-number text-foreground text-lg">{pendingVerification.length}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Unallocated Payments</span>
            <span className="font-number text-foreground text-lg">{unallocated.length}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Unmatched bank lines</span>
            <span className="font-number text-foreground text-lg">{unmatched?.length ?? "—"}</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Verify a payment from the Payments tab once its proof and reference number are checked.
        </p>
      </Card>

      {can.manageReconciliation && (
        <Card className="gap-3">
          <SectionHeading
            title="Import bank statement"
            description="Paste a CSV export — a date, description, reference and amount column (or separate credit/debit columns). No live bank feed exists, so a statement is imported this way."
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Input
              value={bankAccountLabel}
              onChange={(e) => setBankAccountLabel(e.target.value)}
              placeholder="Account label (e.g. Main)"
              className="sm:max-w-48"
            />
            <Textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={"date,description,reference,amount\n2026-09-01,Transfer from Jane Doe,TRX001,45000"}
              className="min-h-28 font-number flex-1"
            />
          </div>
          <Button
            size="sm"
            className="self-start"
            disabled={importing || csv.trim().length === 0}
            onClick={doImport}
          >
            {importing ? <Loader2 className="animate-spin" /> : <Upload />}
            Import
          </Button>
        </Card>
      )}

      <div>
        <SectionHeading title="Unmatched bank lines" />
        {loading ? (
          <p className="text-xs text-muted-foreground mt-3">Loading…</p>
        ) : !unmatched || unmatched.length === 0 ? (
          <EmptyState title="Nothing to match" description="Every imported bank line has a counterparty." />
        ) : (
          <Card className="p-0 overflow-x-auto no-scrollbar mt-3">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {["Date", "Description", "Reference", "Amount", ""].map((label) => (
                    <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {unmatched.map((t) => (
                  <TableRow key={t.id} className="hover:bg-muted/40">
                    <TableCell className="px-3 py-2.5 text-xs font-number text-muted-foreground">
                      {formatDate(t.statement_date)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm text-foreground">
                      {t.description}
                      {t.duplicate_of_id && (
                        <span className={`ml-1.5 inline-flex items-center gap-1 text-[11px] ${TONE_TEXT.warning}`}>
                          <AlertTriangle className="size-3" /> possible duplicate
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-xs font-number text-muted-foreground">
                      {t.reference ?? "—"}
                    </TableCell>
                    <TableCell
                      className={`px-3 py-2.5 text-sm font-number ${t.amount < 0 ? "text-destructive" : "text-foreground"}`}
                    >
                      {formatExactCurrency(t.amount, t.currency)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      {can.manageReconciliation && (
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="outline_without_border" onClick={() => openMatchDialog(t)}>
                            <Search /> Match
                          </Button>
                          <Button size="icon" variant="ghost" aria-label="Ignore" onClick={() => ignore(t.id)}>
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {matches && matches.length > 0 && (
        <div>
          <SectionHeading title="Recently matched" />
          <Card className="p-0 overflow-x-auto no-scrollbar mt-3">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {["Matched to", "Amount", "By", ""].map((label) => (
                    <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {matches.slice(0, 20).map((m) => (
                  <TableRow key={m.id} className="hover:bg-muted/40">
                    <TableCell className="px-3 py-2.5 text-sm text-foreground">
                      {m.matched_label}
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        {m.matched_type === "PAYMENT" ? "Customer" : "Supplier"}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm font-number text-foreground">
                      {formatExactCurrency(m.matched_amount, "LKR")}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                      {m.matched_by_name ?? "—"}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      {can.manageReconciliation && (
                        <Button size="sm" variant="ghost" onClick={() => undo(m.bank_transaction_id)}>
                          <Undo2 /> Undo
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {can.viewReconciliation && (
        <PeriodClosePanel bankAccountLabel={bankAccountLabel} canManage={can.manageReconciliation} />
      )}

      {ignored && ignored.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{ignored.length} ignored line(s)</summary>
          <div className="flex flex-col gap-1 mt-2">
            {ignored.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 py-1">
                <span>
                  {formatDate(t.statement_date)} · {t.description} ·{" "}
                  {formatExactCurrency(t.amount, t.currency)}
                </span>
                {can.manageReconciliation && (
                  <Button size="sm" variant="ghost" onClick={() => restore(t.id)}>
                    Restore
                  </Button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      <Dialog open={matchTarget !== null} onOpenChange={(open) => !open && setMatchTarget(null)}>
        <DialogContent className="max-w-lg!">
          <DialogHeader>
            <DialogTitle>Match bank line</DialogTitle>
            <DialogDescription>
              {matchTarget && (
                <>
                  {matchTarget.description} —{" "}
                  {formatExactCurrency(matchTarget.amount, matchTarget.currency)} on{" "}
                  {formatDate(matchTarget.statement_date)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {extractedPayerName && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Sparkles className="size-3 text-primary" /> Manasik Copilot read the narration as from &ldquo;{extractedPayerName}&rdquo;
              — used only to score candidates below, never to decide a match.
            </p>
          )}
          {aiNote && <p className="text-[11px] text-muted-foreground">{aiNote}</p>}

          {loadingCandidates ? (
            <p className="text-sm text-muted-foreground py-4">Looking for candidates…</p>
          ) : !candidates || candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No {matchTarget && matchTarget.amount > 0 ? "payment" : "supplier payment"} of a matching
              amount was found within 10 days. Record or verify the payment first, then try again.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  {candidates.length} candidate{candidates.length === 1 ? "" : "s"}, ranked by confidence.
                </span>
                {candidates.length > 1 && (
                  <button
                    type="button"
                    className="text-[11px] text-primary underline"
                    onClick={() => setSplitMode((v) => !v)}
                  >
                    {splitMode ? "Cancel split" : "Split across multiple"}
                  </button>
                )}
              </div>
              <div className="flex flex-col divide-y divide-border/20">
                {candidates.map((c) => {
                  const key = `${c.type}:${c.id}`;
                  return (
                    <div key={key} className="flex items-center justify-between gap-3 py-2">
                      {splitMode && (
                        <Checkbox checked={selectedIds.has(key)} onCheckedChange={() => toggleSelected(c)} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground truncate">{c.label}</p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-[11px] text-muted-foreground">{formatDate(c.date)}</p>
                          <ToneBadge tone={CONFIDENCE_TONE[c.confidence]} label={c.confidence} />
                          {prefilledCandidateKey === key && <ToneBadge tone="info" label="Prefilled for review" />}
                        </div>
                        {c.rationale.length > 0 && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">{c.rationale.join(" · ")}</p>
                        )}
                        <ReconciliationCandidateEvidence candidate={c} currency={matchTarget?.currency ?? "LKR"} />
                      </div>
                      {splitMode && selectedIds.has(key) ? (
                        <Input
                          type="number"
                          value={selectedAmounts[key] ?? ""}
                          onChange={(e) => setSelectedAmounts((amounts) => ({ ...amounts, [key]: e.target.value }))}
                          className="w-28 shrink-0 font-number"
                        />
                      ) : (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-number text-foreground">
                            {formatExactCurrency(c.amount, "LKR")}
                          </span>
                          {!splitMode && (
                            <Button size="sm" disabled={confirming === c.id} onClick={() => confirmCandidate(c)}>
                              {confirming === c.id ? <Loader2 className="animate-spin" /> : "Confirm"}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {splitMode && selectedIds.size > 0 && (
                <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
                  <p className="text-xs text-foreground">
                    Selected total: {formatExactCurrency(selectedTotal)} · Bank line:{" "}
                    {matchTarget && formatExactCurrency(Math.abs(matchTarget.amount))}
                  </p>
                  {residualAmount !== 0 && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Residual {formatExactCurrency(residualAmount)} needs a type and reason before confirming.
                      </p>
                      <div className="flex gap-2">
                        <select
                          className="text-xs border rounded-md px-2 py-1.5 bg-background"
                          value={residualType}
                          onChange={(e) => setResidualType(e.target.value as typeof residualType)}
                        >
                          <option value="">Residual type…</option>
                          <option value="UNALLOCATED_CREDIT">Unallocated credit</option>
                          <option value="BANK_CHARGE">Bank charge</option>
                        </select>
                        <Input
                          value={residualReason}
                          onChange={(e) => setResidualReason(e.target.value)}
                          placeholder="Reason"
                          className="text-xs flex-1"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          <DialogFooter>
            <Button variant="outline_without_border" onClick={() => setMatchTarget(null)}>
              Close
            </Button>
            {splitMode && (
              <Button
                onClick={submitSplit}
                disabled={
                  submittingSplit ||
                  selectedIds.size === 0 ||
                  (residualAmount !== 0 && (!residualType || !residualReason.trim()))
                }
              >
                {submittingSplit ? <Loader2 className="animate-spin" /> : `Confirm split (${selectedIds.size})`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
