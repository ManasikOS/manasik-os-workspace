"use client";

import { Sparkles } from "lucide-react";
import React, { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/tone-badge";
import { VISA_NO_UPDATE_CHASE_DAYS } from "@/lib/data/visa-copy";

import { computeGroupVisaBoards } from "@/lib/data/visa";
import type { VisaListItem, VisaQueue } from "../types";

interface AiVisaPanelProps {
  applications: VisaListItem[];
  onOpenQueue: (queue: VisaQueue) => void;
}

/**
 * AI Visa Assistant — an operations copilot, not a decision-maker. Every
 * number here is a deterministic query over the loaded queue, not a model
 * call: counting with an LLM is slower, costlier and occasionally wrong.
 * No code path in this panel reaches a visa transition.
 */
const AiVisaPanel = ({ applications, onOpenQueue }: AiVisaPanelProps) => {
  const summary = useMemo(() => {
    const unresolved = applications.filter((a) => a.visaStatus === "SUBMITTED" || a.visaStatus === "UNDER_REVIEW" || a.visaStatus === "REWORK_REQUIRED");
    const needsCorrection = applications.filter((a) => a.visaStatus === "REWORK_REQUIRED");
    const passportRisk = applications.filter((a) => a.gatingOutstanding > 0 && a.visaStatus === "DOCUMENTS_PENDING");
    const noUpdate = applications.filter(
      (a) => (a.visaStatus === "SUBMITTED" || a.visaStatus === "UNDER_REVIEW") && (a.daysSinceUpdate ?? 0) >= VISA_NO_UPDATE_CHASE_DAYS,
    );
    const boards = computeGroupVisaBoards(applications);
    const priorityGroup = boards.find((b) => b.riskBand === "RED") ?? boards[0];

    return { unresolved, needsCorrection, passportRisk, noUpdate, priorityGroup };
  }, [applications]);

  if (applications.length === 0) {
    return (
      <Card className="gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">AI Visa Assistant</h3>
        </div>
        <EmptyState title="Nothing to summarise" description="No open visa applications right now." />
      </Card>
    );
  }

  return (
    <Card className="gap-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">AI Visa Assistant</h3>
      </div>

      {summary.priorityGroup && <p className="text-xs font-medium text-foreground">{summary.priorityGroup.groupName}:</p>}

      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        <li>· {summary.unresolved.length} applications remain unresolved</li>
        <li>· {summary.needsCorrection.length} need a correction or rework</li>
        <li>· {summary.passportRisk.length} blocked by a document or passport validity issue</li>
        <li>· {summary.noUpdate.length} have no status update for {VISA_NO_UPDATE_CHASE_DAYS}+ days</li>
      </ul>

      {summary.priorityGroup && summary.priorityGroup.riskBand === "RED" && (
        <div className="rounded-md bg-destructive/10 p-2.5">
          <p className="text-[11px] font-medium text-destructive">Recommended action</p>
          <p className="text-[11px] text-destructive">Prioritise {summary.priorityGroup.groupName} before its next deadline.</p>
        </div>
      )}

      <Button variant="outline_without_border" size="sm" onClick={() => onOpenQueue("Rework Required")}>
        Open Recommended Queue
      </Button>
    </Card>
  );
};

export default AiVisaPanel;
