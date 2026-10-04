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
import {
  EmptyState,
  PermissionDenied,
  ToneBadge,
} from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useMemo, useState } from "react";

import type { PilgrimCapabilities } from "@/lib/access/pilgrims-access";
import type { DepartureGroupPilgrimDocumentRow } from "@/lib/types/departure-groups";
import type { Tone } from "@/lib/ui/tone";
import type { PilgrimProfile } from "../../../types";
import {
  rejectPilgrimDocumentAction,
  requestDocumentAction,
  submitDocumentOnBehalfAction,
  verifyPilgrimDocumentAction,
  waivePilgrimDocumentAction,
} from "../../../actions";
import { whatsappLink } from "../../../utils";

const STATUS_LABELS: Record<string, string> = {
  NOT_SUBMITTED: "Missing",
  SUBMITTED: "Submitted",
  VERIFIED: "Verified",
  REJECTED: "Rejected / Rework Required",
  NOT_APPLICABLE: "Not Required",
};
const STATUS_TONES: Record<string, Tone> = {
  NOT_SUBMITTED: "danger",
  SUBMITTED: "info",
  VERIFIED: "success",
  REJECTED: "danger",
  NOT_APPLICABLE: "neutral",
};
const FILTERS = [
  "All",
  "Missing",
  "Submitted",
  "Verified",
  "Rejected / Rework Required",
] as const;

export default function DocumentsTab({
  profile,
  documents,
  can,
}: {
  profile: PilgrimProfile;
  documents: DepartureGroupPilgrimDocumentRow[];
  can: PilgrimCapabilities;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [rejectTarget, setRejectTarget] =
    useState<DepartureGroupPilgrimDocumentRow | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const journey = profile.activeJourneyRaw;

  const filtered = useMemo(() => {
    if (filter === "All") return documents;
    if (filter === "Missing")
      return documents.filter((d) => d.status === "NOT_SUBMITTED");
    if (filter === "Submitted")
      return documents.filter((d) => d.status === "SUBMITTED");
    if (filter === "Verified")
      return documents.filter((d) => d.status === "VERIFIED");
    return documents.filter((d) => d.status === "REJECTED");
  }, [documents, filter]);

  if (!can.viewDocuments) return <PermissionDenied what="Documents" />;
  if (!journey)
    return (
      <EmptyState
        title="No active journey"
        description="Documents apply once this pilgrim is enrolled on a group."
      />
    );

  const refresh = () => router.refresh();

  const requestViaWhatsapp = async (doc: DepartureGroupPilgrimDocumentRow) => {
    window.open(whatsappLink(profile.person.whatsapp_number), "_blank");
    await requestDocumentAction({
      pilgrimId: profile.person.id,
      departureGroupId: journey.departure_group_id,
      documentName: doc.name,
    });
    toast.add({ title: "Request logged" });
    refresh();
  };

  const markReceived = async (doc: DepartureGroupPilgrimDocumentRow) => {
    setBusyId(doc.id);
    const result = await submitDocumentOnBehalfAction({
      pilgrimId: profile.person.id,
      departureGroupId: journey.departure_group_id,
      documentId: doc.id,
      documentName: doc.name,
    });
    setBusyId(null);
    if (!result.ok)
      return toast.add({
        title: "Could not update",
        description: result.error,
      });
    toast.add({ title: "Marked received" });
    refresh();
  };

  const verify = async (doc: DepartureGroupPilgrimDocumentRow) => {
    setBusyId(doc.id);
    const result = await verifyPilgrimDocumentAction({
      pilgrimId: profile.person.id,
      departureGroupId: journey.departure_group_id,
      documentId: doc.id,
      documentName: doc.name,
    });
    setBusyId(null);
    if (!result.ok)
      return toast.add({
        title: "Could not verify",
        description: result.error,
      });
    toast.add({ title: "Document verified" });
    refresh();
  };

  const waive = async (doc: DepartureGroupPilgrimDocumentRow) => {
    setBusyId(doc.id);
    const result = await waivePilgrimDocumentAction({
      pilgrimId: profile.person.id,
      departureGroupId: journey.departure_group_id,
      documentId: doc.id,
      documentName: doc.name,
      reason: "Not applicable to this traveller.",
    });
    setBusyId(null);
    if (!result.ok)
      return toast.add({
        title: "Could not update",
        description: result.error,
      });
    toast.add({ title: "Marked not required" });
    refresh();
  };

  const confirmReject = async () => {
    if (!rejectTarget || !reason.trim()) return;
    setBusyId(rejectTarget.id);
    const result = await rejectPilgrimDocumentAction({
      pilgrimId: profile.person.id,
      departureGroupId: journey.departure_group_id,
      documentId: rejectTarget.id,
      documentName: rejectTarget.name,
      reason: reason.trim(),
    });
    setBusyId(null);
    setRejectTarget(null);
    setReason("");
    if (!result.ok)
      return toast.add({
        title: "Could not reject",
        description: result.error,
      });
    toast.add({ title: "Document sent back" });
    refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            variant={filter === f ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No documents in this view" />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((doc) => (
            <Card key={doc.id} className="gap-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-lg font-medium text-foreground">
                    {doc.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {doc.required ? "Required" : "Optional"} · {doc.category}
                  </span>
                  {doc.status === "REJECTED" && doc.rejection_reason && (
                    <span className="text-xs text-destructive">
                      Reason: {doc.rejection_reason}
                    </span>
                  )}
                  {doc.status === "VERIFIED" && doc.verified_by_name && (
                    <span className="text-xs text-muted-foreground">
                      Verified by {doc.verified_by_name}
                    </span>
                  )}
                </div>
                <ToneBadge
                  tone={STATUS_TONES[doc.status] ?? "neutral"}
                  label={STATUS_LABELS[doc.status] ?? doc.status}
                />
              </div>
              <div className="flex flex-wrap gap-2 mt-1">
                {doc.status === "NOT_SUBMITTED" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline_without_border"
                      onClick={() => requestViaWhatsapp(doc)}
                    >
                      Request via WhatsApp
                    </Button>
                    {can.uploadDocuments && (
                      <Button
                        size="sm"
                        variant="outline_without_border"
                        disabled={busyId === doc.id}
                        onClick={() => markReceived(doc)}
                      >
                        Mark Received
                      </Button>
                    )}
                    {can.verifyDocuments && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === doc.id}
                        onClick={() => waive(doc)}
                      >
                        Mark Not Required
                      </Button>
                    )}
                  </>
                )}
                {doc.status === "SUBMITTED" && can.verifyDocuments && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => verify(doc)}
                      disabled={busyId === doc.id}
                    >
                      Verify
                    </Button>
                    <Button
                      size="sm"
                      variant="outline_without_border"
                      onClick={() => setRejectTarget(doc)}
                    >
                      Send Back
                    </Button>
                  </>
                )}
                {doc.status === "REJECTED" && can.uploadDocuments && (
                  <Button
                    size="sm"
                    variant="outline_without_border"
                    disabled={busyId === doc.id}
                    onClick={() => markReceived(doc)}
                  >
                    Mark Re-submitted
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTarget(null)}
      >
        <DialogContent className="max-w-md gap-4">
          <DialogHeader>
            <DialogTitle>
              Send back &quot;{rejectTarget?.name}&quot;
            </DialogTitle>
          </DialogHeader>
          <textarea
            className="w-full min-h-24 rounded-md border border-border bg-transparent p-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
            placeholder="Why is this document being sent back?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button
              variant="outline_without_border"
              onClick={() => setRejectTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmReject}
              disabled={!reason.trim()}
            >
              Send Back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
