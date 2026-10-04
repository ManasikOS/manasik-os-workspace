"use client";

import { Loader2, ShieldOff, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

import { resumeAgencyAction, suspendAgencyAction } from "../actions";

/**
 * Suspend / resume, gated behind a required reason — every call is logged
 * to `support_sessions` and mirrored into the agency's own activity log
 * (Phase 4 of docs/architecture/multi-tenancy-implementation-plan.md).
 */
export function AgencyStatusActions({ agencyId, status }: { agencyId: string; status: string }) {
  const [open, setOpen] = useState<"SUSPEND" | "RESUME" | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setOpen(null);
    setReason("");
  };

  const submit = async () => {
    if (!open) return;
    setSubmitting(true);
    const result =
      open === "SUSPEND" ? await suspendAgencyAction(agencyId, reason) : await resumeAgencyAction(agencyId, reason);
    setSubmitting(false);

    if (!result.ok) {
      toast.add({ title: "Could not update the agency", description: result.error });
      return;
    }

    toast.add({ title: open === "SUSPEND" ? "Agency suspended" : "Agency resumed" });
    close();
  };

  return (
    <>
      {status === "ACTIVE" ? (
        <Button variant="outline" onClick={() => setOpen("SUSPEND")}>
          <ShieldOff className="size-4" /> Suspend
        </Button>
      ) : status === "SUSPENDED" ? (
        <Button variant="outline" onClick={() => setOpen("RESUME")}>
          <ShieldCheck className="size-4" /> Resume
        </Button>
      ) : null}

      <Dialog open={open !== null} onOpenChange={(next) => !next && close()}>
        <DialogContent className="max-w-md! gap-4">
          <DialogHeader>
            <DialogTitle>{open === "SUSPEND" ? "Suspend this agency" : "Resume this agency"}</DialogTitle>
            <DialogDescription>
              {open === "SUSPEND"
                ? "Every one of this agency's staff loses access immediately. They can still sign in, but see no data."
                : "Restores this agency's staff access immediately."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              Reason (recorded on this agency&apos;s own activity log)
            </label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant={open === "SUSPEND" ? "destructive" : "default"}
              onClick={submit}
              disabled={!reason.trim() || submitting}
            >
              {submitting && <Loader2 className="animate-spin" />}
              {open === "SUSPEND" ? "Suspend" : "Resume"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
