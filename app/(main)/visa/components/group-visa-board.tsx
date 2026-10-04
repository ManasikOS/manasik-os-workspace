"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ProgressBar, ToneBadge } from "@/components/ui/tone-badge";
import { riskBandTone } from "@/lib/data/visa";
import { percentTone } from "@/lib/ui/tone";

import type { GroupVisaBoard } from "../types";
import { daysRemainingLabel } from "../utils";

interface GroupVisaBoardProps {
  boards: GroupVisaBoard[];
  onOpenGroup: (groupId: string) => void;
}

const RISK_LABELS: Record<string, string> = { RED: "At Risk", AMBER: "Watch", GREEN: "On Track" };

/** Secondary "By Group" view — one card per active group, so the Visa team
 *  can see at a glance which group may not legally travel. */
const GroupVisaBoardView = ({ boards, onOpenGroup }: GroupVisaBoardProps) => {
  if (boards.length === 0) {
    return <EmptyState title="No active groups" description="No departure groups have open visa applications." />;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {boards.map((board) => (
        <Card key={board.groupId} className="gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-foreground">{board.groupName}</p>
              <p className="text-xs text-muted-foreground">
                {board.pilgrimCount} pilgrims · {daysRemainingLabel(board.daysToDeparture)}
              </p>
            </div>
            <ToneBadge tone={riskBandTone(board.riskBand)} label={RISK_LABELS[board.riskBand]} />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Visa readiness</span>
            <span className="text-lg font-bold font-number text-foreground">{board.readinessPercent}%</span>
          </div>
          <ProgressBar percent={board.readinessPercent} tone={percentTone(board.readinessPercent)} />

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1 text-xs">
            <span className="text-muted-foreground">Ready to submit</span>
            <span className="text-right font-number text-foreground">{board.readyToSubmit}</span>
            <span className="text-muted-foreground">Submitted</span>
            <span className="text-right font-number text-foreground">{board.submitted}</span>
            <span className="text-muted-foreground">Issued</span>
            <span className="text-right font-number text-foreground">{board.issued}</span>
            <span className="text-muted-foreground">Rework required</span>
            <span className="text-right font-number text-foreground">{board.reworkRequired}</span>
            <span className="text-muted-foreground">Rejected</span>
            <span className="text-right font-number text-foreground">{board.rejected}</span>
          </div>

          {board.criticalBlockers.length > 0 && (
            <div className="rounded-md bg-destructive/10 p-2.5 flex flex-col gap-1">
              {board.criticalBlockers.map((blocker) => (
                <p key={blocker} className="text-[11px] text-destructive">
                  · {blocker}
                </p>
              ))}
            </div>
          )}

          <Button variant="outline_without_border" size="sm" onClick={() => onOpenGroup(board.groupId)}>
            Open Group Visa Queue
          </Button>
        </Card>
      ))}
    </div>
  );
};

export default GroupVisaBoardView;
