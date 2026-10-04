"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PersonChip, ToneBadge } from "@/components/ui/tone-badge";

import { readinessStatusTone } from "@/lib/data/operations";

import { useOperations } from "../../operations-store";
import type { OperationsGuideBoardRow } from "../../types";
import { daysRemainingLabel } from "../../utils";
import AssignGuideDialog from "../assign-guide-dialog";

const READINESS_LABELS: Record<string, string> = {
  READY: "Ready",
  AT_RISK: "At Risk",
  BLOCKED: "Blocked",
  NOT_STARTED: "Not Started",
};

/**
 * The people and day-of-travel execution layer. Run sheet generation,
 * manifest printing and emergency-contact export already exist per group on
 * `guide-operations-tab.tsx` — this board surfaces the cross-group gaps
 * (unassigned guide, missing WhatsApp group, missing emergency contact) and
 * hands off to that existing tooling rather than duplicating it.
 */
const GuidesBriefingsTab = () => {
  const router = useRouter();
  const { snapshot, can, guideOptions } = useOperations();
  const [assignTarget, setAssignTarget] = useState<OperationsGuideBoardRow | null>(null);

  if (snapshot.guideBoard.length === 0) {
    return <EmptyState title="No active groups" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {snapshot.guideBoard.map((g) => (
          <Card key={g.groupId} className="gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{g.groupName}</p>
              <p className="text-xs text-muted-foreground">
                {daysRemainingLabel(g.daysUntilDeparture)} · {g.pilgrimCount} pilgrims
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Primary Guide</span>
                <PersonChip name={g.primaryGuideName} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Backup Guide</span>
                <PersonChip name={g.backupGuideName} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">WhatsApp Group</span>
                <ToneBadge tone={g.hasWhatsappGroup ? "success" : "warning"} label={g.hasWhatsappGroup ? "Created" : "Missing"} className="px-2 py-1 text-[10px]" />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Emergency Contact</span>
                <ToneBadge tone={g.hasEmergencyContact ? "success" : "danger"} label={g.hasEmergencyContact ? "Available" : "Missing"} className="px-2 py-1 text-[10px]" />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <ToneBadge tone={readinessStatusTone(g.readinessStatus)} label={READINESS_LABELS[g.readinessStatus] ?? g.readinessStatus} />
              <div className="flex items-center gap-1">
                {can.assignGuide && (
                  <Button variant="outline_without_border" size="sm" onClick={() => setAssignTarget(g)}>
                    Assign Guide
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => router.push(`/departure-groups/${g.groupId}?tab=guide`)}>
                  Open
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <AssignGuideDialog
        group={assignTarget}
        guideOptions={guideOptions}
        open={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
      />
    </div>
  );
};

export default GuidesBriefingsTab;
