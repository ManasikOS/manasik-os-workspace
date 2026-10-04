"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { markApplicationsSubmittedSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, Send, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { VisaStatusBadge } from "../../components/status-badges";
import { markApplicationsSubmittedAction } from "../../actions";
import type { DepartureGroupManifestRow } from "../../types";

interface MarkApplicationsSubmittedDialogProps {
  manifest: DepartureGroupManifestRow[];
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Lodges the selected pilgrims' visa applications.
 *
 * Eligibility is a single derived state now. `READY_TO_SUBMIT` means every
 * gating document is verified *and* the passport clears the six-month rule —
 * the server works out that fact, and this list simply shows who currently
 * holds it. The previous version tested the counter and a five-state allow-list
 * here, which could offer someone the server would then silently skip.
 */
const MarkApplicationsSubmittedDialog = ({
  manifest,
  departureGroupId,
  open,
  onClose,
}: MarkApplicationsSubmittedDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const eligible = manifest.filter(
    (row) => row.visaStatus === "READY_TO_SUBMIT",
  );

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(eligible.map((row) => row.id)),
  );

  // The dialog stays mounted between opens, so the tick-all default has to be
  // recomputed each time it opens. Seeding it once at mount meant the set held
  // travellers who had since been lodged — "8 of 2 selected", and ids the server
  // then had to skip — while newly-ready travellers arrived unticked.
  useResetOnOpen(open, "", () => {
    setSelected(new Set(eligible.map((row) => row.id)));
    setError(null);
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = () => {
    setError(null);

    const check = markApplicationsSubmittedSchema.safeParse({
      departureGroupId,
      pilgrimIds: [...selected],
    });
    if (!check.success) {
      setError(
        check.error.issues[0]?.message ?? "Select at least one pilgrim.",
      );
      return;
    }

    startTransition(async () => {
      const result = await markApplicationsSubmittedAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Applications lodged",
        description: `${result.submittedCount} visa application${
          result.submittedCount === 1 ? "" : "s"
        } lodged.${
          result.skipped.length > 0
            ? ` Skipped ${result.skipped[0].fullName}: ${result.skipped[0].reason}`
            : ""
        }`,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg!">
        <DialogHeader>
          <DialogTitle>Mark Application Submitted</DialogTitle>
          <DialogDescription>
            Lodges the applications of travellers whose gating documents are all
            verified and whose passport clears the six-month rule.
          </DialogDescription>
        </DialogHeader>

        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody is ready to submit yet. Open a traveller&apos;s document
            checklist to see which requirement is still outstanding.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto custom-scroll rounded-md border border-border/40 p-1.5">
              {eligible.map((row) => (
                <label
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 hover:bg-muted/50 cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggle(row.id)}
                    />
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {row.fullName}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {row.bookingReference}
                      </p>
                    </div>
                  </div>
                  <VisaStatusBadge value={row.visaStatus} />
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {selected.size} of {eligible.length} selected.
            </p>

            {error && (
              <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {eligible.length > 0 && (
            <Button
              disabled={isPending || selected.size === 0}
              onClick={submit}
            >
              {isPending ? <Loader2 className="animate-spin" /> : <Send />}
              Mark Submitted
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MarkApplicationsSubmittedDialog;
