"use client";

import { Sparkles } from "lucide-react";
import React, { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/tone-badge";

import type { OperationsSnapshot, OperationsTabId } from "../types";

interface AiOperationsPanelProps {
  snapshot: OperationsSnapshot;
  onOpenTab: (tab: OperationsTabId, filter?: string) => void;
}

/**
 * AI Operations Agent — a prioritisation and coordination layer, not an
 * autonomous booking tool. Every number here is a deterministic query over
 * the loaded snapshot, exactly like `AiVisaPanel`: no model call, no code
 * path that can confirm a supplier, change a flight, or complete a
 * readiness item. It only ever recommends where staff should look next.
 */
const AiOperationsPanel = ({ snapshot, onOpenTab }: AiOperationsPanelProps) => {
  const summary = useMemo(() => {
    const priorityGroup = [...snapshot.groups].sort((a, b) => a.readinessScore - b.readinessScore)[0];
    const unconfirmedSuppliers = snapshot.supplierRows.filter((r) => r.status === "NOT_REQUESTED" || r.status === "REQUESTED");
    const capacityMismatches = [
      ...snapshot.transports.filter((t) => t.vehicleCapacity !== null && t.passengerCount !== null && t.vehicleCapacity < t.passengerCount),
      ...snapshot.accommodations.filter((a) => a.roomingTone === "danger"),
      ...snapshot.flights.filter((f) => f.riskState === "SEATS_SHORT"),
    ];
    const guidelessGroups = snapshot.groups.filter((g) => !g.primaryGuideName);
    const unassignedTasks = snapshot.tasks.filter((t) => t.status !== "COMPLETE" && !t.ownerName);

    return { priorityGroup, unconfirmedSuppliers, capacityMismatches, guidelessGroups, unassignedTasks };
  }, [snapshot]);

  if (snapshot.groups.length === 0) {
    return (
      <Card className="gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">AI Operations Agent</h3>
        </div>
        <EmptyState title="Nothing to summarise" description="No active groups right now." />
      </Card>
    );
  }

  const blockers = summary.priorityGroup?.blockers.slice(0, 3) ?? [];

  return (
    <Card className="gap-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">AI Operations Agent</h3>
      </div>

      {summary.priorityGroup && (
        <p className="text-xs font-medium text-foreground">
          {summary.priorityGroup.groupName} is {summary.priorityGroup.readinessStatus === "BLOCKED" ? "blocked" : "at risk"}.
        </p>
      )}

      {blockers.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1">Main blockers</p>
          <ol className="flex flex-col gap-1 text-xs text-muted-foreground list-decimal list-inside">
            {blockers.map((b) => (
              <li key={b.id}>{b.message}</li>
            ))}
          </ol>
        </div>
      )}

      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        <li>· {summary.unconfirmedSuppliers.length} supplier service(s) not yet confirmed</li>
        <li>· {summary.capacityMismatches.length} capacity mismatch(es) detected across flights, hotels and transport</li>
        <li>· {summary.guidelessGroups.length} group(s) with no guide assigned</li>
        <li>· {summary.unassignedTasks.length} task(s) with no owner</li>
      </ul>

      {summary.priorityGroup && summary.priorityGroup.readinessStatus === "BLOCKED" && (
        <div className="rounded-md bg-destructive/10 p-2.5">
          <p className="text-[11px] font-medium text-destructive">Recommended action</p>
          <p className="text-[11px] text-destructive">Prioritise {summary.priorityGroup.groupName} before its next deadline.</p>
        </div>
      )}

      <Button variant="outline_without_border" size="sm" onClick={() => onOpenTab("readiness")}>
        Open Recommended Queue
      </Button>
    </Card>
  );
};

export default AiOperationsPanel;
