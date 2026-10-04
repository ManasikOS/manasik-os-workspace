"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ProgressBar } from "@/components/ui/tone-badge";
import { percentTone } from "@/lib/ui/tone";

import type { GroupDocumentBoard } from "../types";
import { daysRemainingLabel, documentTypeLabel } from "../utils";

interface GroupBoardProps {
  boards: GroupDocumentBoard[];
  onOpenGroup: (groupId: string) => void;
}

/** Secondary "By Group" view — one card per active group, so Operations can
 *  see at a glance which group needs immediate attention. */
const GroupBoard = ({ boards, onOpenGroup }: GroupBoardProps) => {
  if (boards.length === 0) {
    return <EmptyState title="No active groups" description="No departure groups have outstanding document requirements." />;
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
            <span className="text-lg font-bold font-number text-foreground">{board.readinessPercent}%</span>
          </div>

          <ProgressBar percent={board.readinessPercent} tone={percentTone(board.readinessPercent)} />

          <div className="flex flex-col gap-1.5 mt-1">
            {board.byType.map((t) => (
              <div key={t.documentType} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{documentTypeLabel(t.documentType)}</span>
                <span className="font-number text-foreground">
                  {t.verified} / {t.total}
                </span>
              </div>
            ))}
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
            Open Group Document Queue
          </Button>
        </Card>
      ))}
    </div>
  );
};

export default GroupBoard;
