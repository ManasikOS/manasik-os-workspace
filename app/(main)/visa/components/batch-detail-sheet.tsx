"use client";

import { Loader2 } from "lucide-react";
import React, { useMemo, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToneBadge } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import { visaStatusTone } from "@/lib/data/visa";

import { markBatchSubmittedAction } from "../actions";
import { visaApplicationsToManifestCsv, downloadTextFile, timestampedFilename } from "../csv";
import type { VisaCapabilities, VisaListItem } from "../types";
import { VISA_STATUS_LABELS, formatDateTime } from "../utils";

interface BatchDetailSheetProps {
  batchId: string | null;
  applications: VisaListItem[];
  can: VisaCapabilities;
  open: boolean;
  onClose: () => void;
}

const BatchDetailSheet = ({ batchId, applications, can, open, onClose }: BatchDetailSheetProps) => {
  const [isPending, startTransition] = useTransition();

  const members = useMemo(() => applications.filter((a) => a.batchId === batchId), [applications, batchId]);
  const first = members[0];

  const submitted = members.filter((m) => m.visaStatus !== "READY_TO_SUBMIT" && m.visaStatus !== "REWORK_REQUIRED").length;
  const rework = members.filter((m) => m.visaStatus === "REWORK_REQUIRED").length;
  const pending = members.filter((m) => m.visaStatus === "READY_TO_SUBMIT").length;

  const markSubmitted = () => {
    if (!batchId) return;
    startTransition(async () => {
      const result = await markBatchSubmittedAction({ batchId });
      if (!result.ok) {
        toast.add({ title: "Could not mark submitted", description: result.error });
        return;
      }
      toast.add({ title: "Batch marked submitted" });
      onClose();
    });
  };

  const exportManifest = () => {
    downloadTextFile(timestampedFilename("visa-batch-manifest"), visaApplicationsToManifestCsv(members));
  };

  if (!batchId || !first) return null;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {first.groupName} · {first.batchReference}
          </SheetTitle>
          <SheetDescription>
            {members.length} selected · {submitted} submitted · {rework} rework required · {pending} pending submission
            {first.submissionDeadline && <> · Deadline {formatDateTime(first.submissionDeadline)}</>}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 overflow-y-auto">
          {members.map((m) => (
            <div key={m.journeyId} className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2">
              <div>
                <p className="text-sm text-foreground">{m.fullName}</p>
                <p className="text-[11px] text-muted-foreground">{m.pilgrimReference}</p>
              </div>
              <ToneBadge tone={visaStatusTone(m.visaStatus)} label={VISA_STATUS_LABELS[m.visaStatus] ?? m.visaStatus} />
            </div>
          ))}
        </div>

        <SheetFooter className="flex-wrap justify-start gap-2">
          {can.exportSubmissionPack && (
            <Button variant="outline_without_border" size="sm" onClick={exportManifest}>
              Export Submission Pack
            </Button>
          )}
          {can.markSubmitted && pending > 0 && (
            <Button size="sm" onClick={markSubmitted} disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />} Mark All Selected Submitted
            </Button>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default BatchDetailSheet;
