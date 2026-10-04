"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  PermissionDenied,
  ToneBadge,
} from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState } from "react";

import type { PilgrimCapabilities } from "@/lib/access/pilgrims-access";
import type { PilgrimProfile } from "../../../types";
import {
  markVisaReadyOrSubmittedAction,
  markVisaUnderReviewAction,
  rejectPilgrimVisaAction,
  uploadPilgrimVisaAction,
} from "../../../actions";
import { VISA_STATUS_LABELS, VISA_STATUS_TONES } from "../../../utils";
import SectionHeading from "@/components/section-heading";

export default function VisaTab({
  profile,
  can,
}: {
  profile: PilgrimProfile;
  can: PilgrimCapabilities;
}) {
  const router = useRouter();
  const journey = profile.activeJourneyRaw;
  const [busy, setBusy] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [visaId, setVisaId] = useState("");
  const [expiry, setExpiry] = useState("");
  const [reason, setReason] = useState("");

  if (!can.viewPassportAndIdentity && !can.manageVisa)
    return <PermissionDenied what="Visa" />;
  if (!journey)
    return (
      <EmptyState
        title="No active journey"
        description="A visa applies once this pilgrim is enrolled on a group."
      />
    );

  const refresh = () => router.refresh();
  const base = {
    pilgrimId: profile.person.id,
    departureGroupId: journey.departure_group_id,
    journeyId: journey.journey_id,
  };

  const submit = async () => {
    setBusy(true);
    const result = await markVisaReadyOrSubmittedAction(base);
    setBusy(false);
    if (!result.ok)
      return toast.add({
        title: "Could not update",
        description: result.error,
      });
    toast.add({ title: "Visa marked submitted" });
    refresh();
  };

  const underReview = async () => {
    setBusy(true);
    const result = await markVisaUnderReviewAction(base);
    setBusy(false);
    if (!result.ok)
      return toast.add({
        title: "Could not update",
        description: result.error,
      });
    toast.add({ title: "Moved to review" });
    refresh();
  };

  const approve = async () => {
    setBusy(true);
    const result = await uploadPilgrimVisaAction({
      ...base,
      visaId,
      expiryDate: expiry || null,
    });
    setBusy(false);
    if (!result.ok)
      return toast.add({
        title: "Could not record visa",
        description: result.error,
      });
    toast.add({ title: "Visa approved" });
    setApproveOpen(false);
    setVisaId("");
    setExpiry("");
    refresh();
  };

  const reject = async () => {
    setBusy(true);
    const result = await rejectPilgrimVisaAction({
      ...base,
      reason,
      canReapply: true,
    });
    setBusy(false);
    if (!result.ok)
      return toast.add({
        title: "Could not reject visa",
        description: result.error,
      });
    toast.add({ title: "Visa rejected" });
    setRejectOpen(false);
    setReason("");
    refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-3">
        <div className="flex items-center justify-between">
          <SectionHeading title="Visa Status" />
          <ToneBadge
            tone={VISA_STATUS_TONES[journey.visa_status] ?? "neutral"}
            label={
              VISA_STATUS_LABELS[journey.visa_status] ?? journey.visa_status
            }
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block">
              Visa type
            </span>
            {journey.journey_type}
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">
              Visa number
            </span>
            {journey.visa_status === "APPROVED" ? "On file" : "—"}
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">
              Submitted
            </span>
            {journey.visa_submitted_at ?? "Not yet"}
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Expiry</span>
            {journey.passport_expiry ?? "—"}
          </div>
        </div>

        {can.manageVisa && (
          <div className="flex flex-wrap gap-2 mt-2">
            {(journey.visa_status === "NOT_STARTED" ||
              journey.visa_status === "DOCUMENTS_PENDING" ||
              journey.visa_status === "READY_TO_SUBMIT") && (
              <Button size="sm" disabled={busy} onClick={submit}>
                Record Submission
              </Button>
            )}
            {journey.visa_status === "SUBMITTED" && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={underReview}
              >
                Mark Under Review
              </Button>
            )}
            {(journey.visa_status === "SUBMITTED" ||
              journey.visa_status === "UNDER_REVIEW") && (
              <>
                <Button size="sm" onClick={() => setApproveOpen(true)}>
                  Mark Approved
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setRejectOpen(true)}
                >
                  Request Rework
                </Button>
              </>
            )}
          </div>
        )}
      </Card>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="max-w-md gap-4">
          <DialogHeader>
            <DialogTitle>Record approved visa</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              placeholder="Visa number"
              value={visaId}
              onChange={(e) => setVisaId(e.target.value)}
            />
            <Input
              type="date"
              placeholder="Expiry date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={approve} disabled={!visaId.trim() || busy}>
              Mark Approved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md gap-4">
          <DialogHeader>
            <DialogTitle>Request visa rework</DialogTitle>
          </DialogHeader>
          <textarea
            className="w-full min-h-24 rounded-md border border-border bg-transparent p-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
            placeholder="Why was the visa rejected?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={reject}
              disabled={!reason.trim() || busy}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
