"use client";

import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import React, { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import SectionHeading from "@/components/section-heading";
import { PersonChip, ToneBadge } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";

import { getVisaTimelineAction, moveVisaUnderReviewAction, updateReferenceAction, verifyIssueAction } from "../actions";
import type { VisaApplicationEventRow, VisaCapabilities, VisaListItem } from "../types";
import {
  VALIDITY_STATE_LABELS,
  VISA_STATUS_LABELS,
  daysRemainingLabel,
  formatDate,
  formatDateTime,
  riskBandTone,
  validityTone,
  visaStatusTone,
  whatsappLink,
} from "../utils";
import RecordDecisionDialog from "./record-decision-dialog";
import RecordIssueDialog from "./record-issue-dialog";
import StatusCheckDialog from "./status-check-dialog";

import { displayActorName } from "@/lib/agent/identity";
interface ApplicationSheetProps {
  item: VisaListItem | null;
  open: boolean;
  onClose: () => void;
  can: VisaCapabilities;
}

const ApplicationSheet = ({ item, open, onClose, can }: ApplicationSheetProps) => {
  const [isPending, startTransition] = useTransition();
  const [timeline, setTimeline] = useState<VisaApplicationEventRow[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [reference, setReference] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [statusCheckOpen, setStatusCheckOpen] = useState(false);

  useResetOnOpen(open, item?.journeyId ?? "", () => {
    setReference(item?.applicationReference ?? "");
    setTimeline([]);
    setLoadingTimeline(true);
  });

  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    getVisaTimelineAction(item.journeyId).then((rows) => {
      if (cancelled) return;
      setTimeline(rows);
      setLoadingTimeline(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, item]);

  if (!item) return null;

  const saveReference = () => {
    startTransition(async () => {
      const result = await updateReferenceAction(item.journeyId, reference.trim() || null);
      if (!result.ok) {
        toast.add({ title: "Could not save", description: result.error });
        return;
      }
      toast.add({ title: "Application reference saved" });
    });
  };

  const underReview = () => {
    startTransition(async () => {
      const result = await moveVisaUnderReviewAction(item.journeyId);
      if (!result.ok) {
        toast.add({ title: "Could not update", description: result.error });
        return;
      }
      toast.add({ title: "Moved to Under Review" });
    });
  };

  const verify = () => {
    startTransition(async () => {
      const result = await verifyIssueAction({ id: item.journeyId });
      if (!result.ok) {
        toast.add({ title: "Could not verify", description: result.error });
        return;
      }
      toast.add({ title: "Visa marked issued and verified" });
    });
  };

  const ready = item.gatingOutstanding === 0 && item.rejectedDocuments === 0;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="sm:max-w-4xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Visa Application</SheetTitle>
          <SheetDescription className="flex flex-col gap-1">
            <span className="text-foreground font-medium">{item.fullName}</span>
            <span>
              {item.pilgrimReference} · Passport: {item.passportMasked}
            </span>
            <span>
              {item.groupName} · {daysRemainingLabel(item.daysToDeparture)}
            </span>
            <span className="flex items-center gap-2 mt-1">
              <ToneBadge tone={visaStatusTone(item.visaStatus)} label={VISA_STATUS_LABELS[item.visaStatus] ?? item.visaStatus} />
              <ToneBadge tone={riskBandTone(item.riskBand)} label={item.riskBand === "RED" ? "At Risk" : item.riskBand === "AMBER" ? "Watch" : "On Track"} />
              <span className="text-xs">Assigned to: {item.assignedToName ?? "Unassigned"}</span>
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="grid lg:grid-cols-2 gap-4 px-4 overflow-y-auto">
          <div className="flex flex-col gap-4">
            <Card className="gap-3">
              <SectionHeading title="Application Summary" />
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground block">Visa Type</span>
                  {item.visaType}
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Application Status</span>
                  {VISA_STATUS_LABELS[item.visaStatus] ?? item.visaStatus}
                </div>
                <div className="col-span-2 flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Application Reference</span>
                  <div className="flex gap-2">
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} disabled={!can.manageBatch} placeholder="—" />
                    {can.manageBatch && (
                      <Button size="sm" variant="outline_without_border" onClick={saveReference} disabled={isPending}>
                        Save
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Submission Batch</span>
                  {item.batchReference ? `${item.batchReference} · Batch ${item.batchSequence}` : "—"}
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Submitted Date</span>
                  {formatDate(item.submittedAt)}
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Assigned Visa Officer</span>
                  <PersonChip name={item.assignedToName} />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Last Status Check</span>
                  {formatDateTime(item.statusCheckedAt)}
                </div>
              </div>
            </Card>

            <Card className="gap-3">
              <SectionHeading title="Eligibility & Document Checklist" />
              <div className="flex flex-col gap-1.5 text-sm">
                <div className="flex items-center gap-2">
                  {item.gatingOutstanding === 0 ? (
                    <CheckCircle2 className={cn("size-4", TONE_TEXT.success)} />
                  ) : (
                    <span className={cn("size-4 text-center", TONE_TEXT.warning)}>⚠</span>
                  )}
                  <span>
                    {item.documentsCompleted} / {item.documentsRequired} required documents verified
                  </span>
                </div>
                {item.gatingOutstanding > 0 && (
                  <p className={cn("text-xs pl-6", TONE_TEXT.warning)}>
                    {item.gatingOutstanding} gating requirement(s) still outstanding.
                  </p>
                )}
                {item.rejectedDocuments > 0 && (
                  <p className="text-xs text-destructive pl-6">{item.rejectedDocuments} document(s) rejected — rework needed.</p>
                )}
              </div>
              <p className={cn("text-xs", ready ? TONE_TEXT.success : "text-muted-foreground")}>
                {ready ? "Application is ready for submission." : "Resolve outstanding items in Documents before submitting."}
              </p>
              <Link href="/documents" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline w-fit">
                Open Documents queue <ExternalLink className="size-3" />
              </Link>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card className="gap-3">
              <SectionHeading title="Visa Submission Details" />
              <div className="flex flex-wrap gap-2">
                {can.recordStatusCheck && item.visaStatus === "SUBMITTED" && (
                  <Button size="sm" variant="outline" onClick={underReview} disabled={isPending}>
                    Mark Under Review
                  </Button>
                )}
                {can.recordStatusCheck && (item.visaStatus === "SUBMITTED" || item.visaStatus === "UNDER_REVIEW") && (
                  <Button size="sm" variant="outline_without_border" onClick={() => setStatusCheckOpen(true)}>
                    Record Status Check
                  </Button>
                )}
              </div>
            </Card>

            <Card className="gap-3">
              <SectionHeading title="Visa Timeline" />
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto custom-scroll">
                {loadingTimeline ? (
                  <Loader2 className="animate-spin size-4 text-muted-foreground" />
                ) : timeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
                ) : (
                  timeline.map((event) => (
                    <div key={event.id} className="flex flex-col gap-0.5 border-b border-border/30 pb-1.5 last:border-0">
                      <span className="text-xs text-foreground">
                        {event.action.replace(/_/g, " ")} — {displayActorName(event.actor_name)}
                      </span>
                      {event.note && <span className="text-[11px] text-muted-foreground">{event.note}</span>}
                      <span className="text-[10px] text-muted-foreground">{formatDateTime(event.created_at)}</span>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="gap-3">
              <SectionHeading title="Issue / Rework Resolution" />
              {item.visaId ? (
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Visa {item.visaId}</span>
                    {item.verifiedAt ? (
                      <ToneBadge tone="success" label="Verified" />
                    ) : (
                      <ToneBadge tone="warning" label="Unverified" />
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(item.issueDate)} → {formatDate(item.expiryDate)}
                  </span>
                  {item.validityState !== "NONE" && (
                    <ToneBadge tone={validityTone(item.validityState)} label={VALIDITY_STATE_LABELS[item.validityState]} className="w-fit" />
                  )}
                </div>
              ) : item.rejectionReason ? (
                <p className="text-xs text-destructive">{item.rejectionReason}</p>
              ) : (
                <p className="text-xs text-muted-foreground">No decision recorded yet.</p>
              )}

              <div className="flex flex-wrap gap-2">
                {can.recordIssuedVisa && (
                  <Button size="sm" onClick={() => setIssueOpen(true)}>
                    {item.visaId ? "Amend Issued Visa" : "Record Issued Visa"}
                  </Button>
                )}
                {can.verifyIssuedVisa && item.visaId && !item.verifiedAt && (
                  <Button size="sm" variant="outline" onClick={verify} disabled={isPending}>
                    Mark Issued & Verified
                  </Button>
                )}
                {can.recordRejection && item.visaStatus !== "APPROVED" && (
                  <Button size="sm" variant="destructive" onClick={() => setDecisionOpen(true)}>
                    Record Rejection
                  </Button>
                )}
                {item.whatsappNumber && (
                  <Button size="sm" variant="ghost" render={<a href={whatsappLink(item.whatsappNumber)} target="_blank" rel="noreferrer" />}>
                    Draft WhatsApp
                  </Button>
                )}
              </div>
            </Card>
          </div>
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>

      <RecordIssueDialog item={issueOpen ? item : null} open={issueOpen} onClose={() => setIssueOpen(false)} />
      <RecordDecisionDialog item={decisionOpen ? item : null} open={decisionOpen} onClose={() => setDecisionOpen(false)} />
      <StatusCheckDialog journeyIds={[item.journeyId]} itemsLabel={item.fullName} open={statusCheckOpen} onClose={() => setStatusCheckOpen(false)} />
    </Sheet>
  );
};

export default ApplicationSheet;
