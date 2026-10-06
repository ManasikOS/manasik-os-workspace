"use client";

/**
 * Approve / Reject for one agent proposal — §12.1 of
 * docs/modules/departure-operations-agent-implementation-plan.md. "Edit & Approve"
 * (§9.2) is deliberately not built here yet: editing needs a per-kind form
 * generated from the executor's own Zod schema (18 different shapes), which
 * is real work on its own — approve-as-written or reject covers the core
 * workflow this phase delivers.
 */

import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import React, { useState, useTransition } from "react";

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
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { DepartureGroupCapabilities } from "@/lib/access/departure-groups-access";

import {
  approveAgentProposalAction,
  rejectAgentProposalAction,
} from "../../agent-proposal-actions";
import type { GroupAgentProposal } from "@/lib/data/departure-groups-agent";
import { ToneBadge } from "@/components/ui/tone-badge";
import { proposalStatusTone, riskTone } from "../../components/agent-tone";
import { formatDateTime } from "../../utils";
import { TONE_CLASS } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

interface ProposalDecisionDialogProps {
  proposal: GroupAgentProposal | null;
  role: StaffRole;
  open: boolean;
  onClose: () => void;
}

const ProposalDecisionDialog = ({ proposal, role, open, onClose }: ProposalDecisionDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [decisionNote, setDecisionNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, proposal?.id ?? "", () => {
    setDecisionNote("");
    setError(null);
  });

  const can = useDepartureCapabilities(role);

  if (!proposal) return null;

  const capabilityKey = proposal.requiredCapability as keyof DepartureGroupCapabilities;
  const hasCapability = can[capabilityKey] === true;
  const isHighRisk = proposal.risk === "HIGH";
  // The real gate is server-side (approveAgentProposalAction re-checks
  // capability and, for HIGH risk, the agency's configured approver roles)
  // — this is only what decides whether the buttons are worth showing.
  const canDecide = hasCapability;

  const approve = () => {
    setError(null);
    startTransition(async () => {
      const result = await approveAgentProposalAction(proposal.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.add({ title: "Proposal approved", description: proposal.title });
      onClose();
    });
  };

  const reject = () => {
    setError(null);
    if (proposal.risk !== "LOW" && !decisionNote.trim()) {
      setError("A rejection needs a reason for anything above LOW risk.");
      return;
    }
    startTransition(async () => {
      const result = await rejectAgentProposalAction(proposal.id, decisionNote.trim() || undefined);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.add({ title: "Proposal rejected", description: proposal.title });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {proposal.title}
          </DialogTitle>
          <DialogDescription>
            Expires {formatDateTime(proposal.expiresAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={riskTone(proposal.risk)} label={`${proposal.risk} risk`} />
          <ToneBadge tone={proposalStatusTone(proposal.status)} label={proposal.status.replace(/_/g, " ")} />
        </div>

        <div className="flex flex-col gap-4 py-1">
          <p className="text-sm text-foreground">{proposal.rationale}</p>

          {proposal.humanDiff.length > 0 && (
            <div className="rounded-md border p-3">
              <p className="text-[11px] font-medium text-muted-foreground mb-2">What changes</p>
              <div className="flex flex-col gap-1.5">
                {proposal.humanDiff.map((line, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground min-w-24">{line.field}</span>
                    <span className="text-muted-foreground/70">{String(line.from ?? "—")}</span>
                    <ArrowRight className="size-3 text-muted-foreground" />
                    <span className="font-medium text-foreground">{String(line.to ?? "—")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {proposal.evidence.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Evidence</p>
              <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground list-disc list-inside">
                {proposal.evidence.map((e, i) => (
                  <li key={i}>{e.label}</li>
                ))}
              </ul>
            </div>
          )}

          {proposal.draftBody && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Draft message</p>
              <div className="rounded-md bg-muted/40 p-2.5 text-sm whitespace-pre-wrap">{proposal.draftBody}</div>
            </div>
          )}

          {!canDecide && (
            <div className={cn("flex items-start gap-2 rounded-md p-2.5 text-xs", TONE_CLASS.warning)}>
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              <span>Your role cannot decide on this proposal. It needs the capability that manages this kind of change{isHighRisk ? ", and a high-risk approver at this agency" : ""}.</span>
            </div>
          )}

          {canDecide && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1">
                Rejection reason {proposal.risk !== "LOW" && <span className="text-destructive">(required)</span>}
              </p>
              <Textarea
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="Why this isn't right — the agent won't propose the same thing again for a while."
                rows={2}
                disabled={isPending}
              />
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Close
          </Button>
          {canDecide && (
            <>
              <Button variant="destructive" onClick={reject} disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" /> : null} Reject
              </Button>
              <Button onClick={approve} disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" /> : null} Approve
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProposalDecisionDialog;
