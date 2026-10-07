"use client";

import { Bot, ScanSearch, Settings } from "lucide-react";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";

import { runBulkAiScanAction } from "../actions";
import type { DocumentListItem } from "../types";

interface AiAgentPanelProps {
  documents: DocumentListItem[];
  aiConfigured: boolean;
  canRunScan: boolean;
  onOpenAiQueue: () => void;
  onOpenSettings: () => void;
}

/** Compact panel — the agent works through queues and findings, never a
 *  chatbot. Counts are for the current day's activity. */
const AiAgentPanel = ({
  documents,
  aiConfigured,
  canRunScan,
  onOpenAiQueue,
  onOpenSettings,
}: AiAgentPanelProps) => {
  const [isPending, startTransition] = useTransition();

  const scanned = documents.filter((d) => d.aiVerdict !== null);
  const needsReview = scanned.filter(
    (d) => d.aiVerdict === "WARNING" || d.aiVerdict === "BLOCKED",
  );
  const highRisk = scanned.filter((d) => d.aiVerdict === "BLOCKED");
  const topIssueType = mostCommon(needsReview.map((d) => d.documentType));

  const runPending = () => {
    const pending = documents
      .filter((d) => d.status === "SUBMITTED" && d.aiVerdict === null)
      .slice(0, 25);
    if (pending.length === 0) {
      toast.add({
        title: "Nothing to scan",
        description: "Every submitted document has already been analysed.",
      });
      return;
    }
    startTransition(async () => {
      const result = await runBulkAiScanAction(
        pending.map((d) => d.documentId),
      );
      if (!result.ok) {
        toast.add({
          title: "Scan could not complete",
          description: result.error,
        });
        return;
      }
      toast.add({
        title: "Scan complete",
        description: `${pending.length} document(s) analysed.`,
      });
    });
  };

  return (
    <Card className="gap-4">
      <div className="flex items-center gap-2">
        <Bot className="size-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">
          Manasik Copilot — Document Review
        </h3>
      </div>

      {!aiConfigured && (
        <p className="text-xs text-muted-foreground">
          Not configured for this environment. Findings and classification are
          unavailable until an administrator sets up the agent.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-2xl font-bold tabular-nums text-foreground">
            {scanned.length}
          </p>
          <p className="text-[11px] text-muted-foreground">Processed today</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums text-foreground">
            {scanned.length - needsReview.length}
          </p>
          <p className="text-[11px] text-muted-foreground">Auto-classified</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums text-foreground">
            {needsReview.length}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Needs human review
          </p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums text-destructive">
            {highRisk.length}
          </p>
          <p className="text-[11px] text-muted-foreground">
            High-risk findings
          </p>
        </div>
      </div>

      {topIssueType && (
        <p className="text-xs text-muted-foreground">
          Top issue: <span className="text-foreground">{topIssueType}</span>{" "}
          needs re-upload
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button
          variant="outline_without_border"
          size="sm"
          onClick={onOpenAiQueue}
        >
          Review AI Queue
        </Button>
        {canRunScan && (
          <Button
            variant="outline_without_border"
            size="sm"
            disabled={!aiConfigured || isPending}
            onClick={runPending}
          >
            <ScanSearch />{" "}
            {isPending ? "Scanning…" : "Run Scan on Pending Files"}
          </Button>
        )}
        {canRunScan && (
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            <Settings /> Agent Settings
          </Button>
        )}
      </div>
    </Card>
  );
};

function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export default AiAgentPanel;
