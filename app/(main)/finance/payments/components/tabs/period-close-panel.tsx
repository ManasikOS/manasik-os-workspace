"use client";

import { useEffect, useState } from "react";

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
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/tone-badge";
import SectionHeading from "@/components/section-heading";
import { Loader2, Lock, LockOpen } from "lucide-react";

import {
  closeReconciliationPeriodAction,
  createReconciliationPeriodAction,
  listReconciliationPeriodsAction,
  reopenReconciliationPeriodAction,
} from "../../actions";
import type { ReconciliationPeriodRow } from "@/lib/data/reconciliation-repository";
import { formatDate, formatExactCurrency } from "../../utils";

/**
 * Period close-off (plan §4.19 gap 4). A CLOSED period's bank lines are
 * locked against new/undone matches by a database trigger
 * (`enforce_reconciliation_period_lock` in
 * `20261110090000_p1_3_reconciliation_v2.sql`) — this panel is only the
 * workflow on top of that: open a period, close it once the checklist
 * server-side actually passes, reopen one if a human needs to fix something.
 */
export default function PeriodClosePanel({ bankAccountLabel, canManage }: { bankAccountLabel: string; canManage: boolean }) {
  const [periods, setPeriods] = useState<ReconciliationPeriodRow[] | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [creating, setCreating] = useState(false);

  const [closing, setClosing] = useState<ReconciliationPeriodRow | null>(null);
  const [closingBalance, setClosingBalance] = useState("0");
  const [cashCounted, setCashCounted] = useState(false);
  const [checklistErrors, setChecklistErrors] = useState<{ label: string; done: boolean }[] | null>(null);
  const [submittingClose, setSubmittingClose] = useState(false);

  const refresh = async () => {
    const result = await listReconciliationPeriodsAction(bankAccountLabel);
    setPeriods(result.ok ? result.periods : []);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankAccountLabel]);

  const createPeriod = async () => {
    setCreating(true);
    const result = await createReconciliationPeriodAction({
      bankAccountLabel,
      periodFrom,
      periodTo,
      openingBalance: Number(openingBalance) || 0,
    });
    setCreating(false);
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not open that period" });
      return;
    }
    toast.add({ title: "Period opened" });
    setOpenDialog(false);
    setPeriodFrom("");
    setPeriodTo("");
    refresh();
  };

  const submitClose = async () => {
    if (!closing) return;
    setSubmittingClose(true);
    setChecklistErrors(null);
    const result = await closeReconciliationPeriodAction({
      periodId: closing.id,
      closingBalance: Number(closingBalance) || 0,
      cashCounted,
    });
    setSubmittingClose(false);
    if (!result.ok) {
      if (result.checklist) setChecklistErrors(result.checklist);
      toast.add({ title: result.error ?? "Could not close that period" });
      return;
    }
    toast.add({ title: "Period closed" });
    setClosing(null);
    refresh();
  };

  const reopen = async (periodId: string) => {
    const result = await reopenReconciliationPeriodAction(periodId);
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not reopen that period" });
      return;
    }
    toast.add({ title: "Period reopened" });
    refresh();
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <SectionHeading
          title="Period close"
          description={`Bank account: ${bankAccountLabel}. A closed period locks its bank lines against new or undone matches.`}
        />
        {canManage && (
          <Button size="sm" variant="outline_without_border" onClick={() => setOpenDialog(true)}>
            Open period
          </Button>
        )}
      </div>

      {!periods ? (
        <p className="text-xs text-muted-foreground mt-3">Loading…</p>
      ) : periods.length === 0 ? (
        <EmptyState title="No periods yet" description="Open a period to start the close-off workflow for this account." />
      ) : (
        <div className="flex flex-col gap-2 mt-3">
          {periods.map((p) => (
            <Card key={p.id} className="flex-row items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  {formatDate(p.period_from)} – {formatDate(p.period_to)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Opening {formatExactCurrency(p.opening_balance)}
                  {p.closing_balance !== null ? ` · Closing ${formatExactCurrency(p.closing_balance)}` : ""}
                  {p.closed_by_name ? ` · Closed by ${p.closed_by_name}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={p.status === "CLOSED" ? "secondary" : "default"} className="text-[10px] gap-1">
                  {p.status === "CLOSED" ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
                  {p.status}
                </Badge>
                {canManage && p.status !== "CLOSED" && (
                  <Button size="sm" variant="outline_without_border" onClick={() => setClosing(p)}>
                    Close
                  </Button>
                )}
                {canManage && p.status === "CLOSED" && (
                  <Button size="sm" variant="ghost" onClick={() => reopen(p.id)}>
                    Reopen
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open reconciliation period</DialogTitle>
            <DialogDescription>{bankAccountLabel}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">From</label>
                <Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">To</label>
                <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Opening balance</label>
              <Input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenDialog(false)}>
              Cancel
            </Button>
            <Button onClick={createPeriod} disabled={creating || !periodFrom || !periodTo}>
              {creating ? <Loader2 className="animate-spin" /> : "Open"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closing !== null} onOpenChange={(open) => !open && setClosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close period</DialogTitle>
            <DialogDescription>
              {closing && `${formatDate(closing.period_from)} – ${formatDate(closing.period_to)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Closing balance</label>
              <Input type="number" value={closingBalance} onChange={(e) => setClosingBalance(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={cashCounted} onCheckedChange={(v) => setCashCounted(v === true)} />
              Cash on hand has been counted and recorded
            </label>
            {checklistErrors && (
              <div className="flex flex-col gap-1 rounded-md bg-destructive/10 p-2.5">
                {checklistErrors.map((item) => (
                  <p key={item.label} className={`text-xs ${item.done ? "text-muted-foreground" : "text-destructive"}`}>
                    {item.done ? "✓" : "✗"} {item.label}
                  </p>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClosing(null)}>
              Cancel
            </Button>
            <Button onClick={submitClose} disabled={submittingClose}>
              {submittingClose ? <Loader2 className="animate-spin" /> : "Close period"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
