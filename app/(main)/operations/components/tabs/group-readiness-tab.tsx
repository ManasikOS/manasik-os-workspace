"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useMemo } from "react";

import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";

import {
  buildReadinessMatrixRows,
  readinessStatusTone,
} from "@/lib/data/operations";
import { percentTone, TONE_TEXT } from "@/lib/ui/tone";

import { useOperations } from "../../operations-store";
import type { OperationsTabId } from "../../types";
import { daysRemainingLabel } from "../../utils";

interface GroupReadinessTabProps {
  onNavigate: (tab: OperationsTabId, filter?: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  READY: "Ready",
  AT_RISK: "At Risk",
  BLOCKED: "Blocked",
  NOT_STARTED: "Not Started",
};

/**
 * The cross-group readiness matrix — separate from the detailed Readiness
 * tab inside each individual group. Every percentage is clickable into the
 * exact unresolved queue that owns it; no cell renders a number without the
 * primary blocker sentence beside the row.
 */
const GroupReadinessTab = ({ onNavigate }: GroupReadinessTabProps) => {
  const router = useRouter();
  const { snapshot } = useOperations();

  const rows = useMemo(
    () => buildReadinessMatrixRows(snapshot.groups),
    [snapshot.groups],
  );

  if (rows.length === 0) {
    return <EmptyState title="No active groups" />;
  }

  return (
    <div className="rounded-md bg-card/60 dark:bg-gray-950/10 border border-muted/50 backdrop-blur-lg shadow-lg overflow-hidden">
      <div
        className="overflow-auto no-scrollbar w-full"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <table className="w-full text-left border-collapse">
          <thead className="bg-card/70 sticky top-0 z-10 shadow-2xs">
            <tr>
              <th className="h-11 px-4 text-xs font-medium tracking-tight text-muted-foreground whitespace-nowrap text-left">
                Group
              </th>
              {rows[0]?.cells.map((c) => (
                <th
                  key={c.category}
                  className="h-11 px-4 text-xs font-medium tracking-tight text-muted-foreground whitespace-nowrap text-center"
                >
                  {c.label}
                </th>
              ))}
              <th className="h-11 px-4 text-xs font-medium tracking-tight text-muted-foreground whitespace-nowrap text-center">
                Overall
              </th>
              <th className="h-11 px-4 text-xs font-medium tracking-tight text-muted-foreground whitespace-nowrap">
                Status / Blocker
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {rows.map((row) => (
              <tr key={row.groupId} className="hover:bg-muted/40">
                <td className="px-4 py-4 align-middle whitespace-nowrap">
                  <button
                    className="text-left"
                    onClick={() =>
                      router.push(`/departure-groups/${row.groupId}`)
                    }
                  >
                    <p className="text-sm font-medium text-foreground hover:underline">
                      {row.groupName}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {daysRemainingLabel(row.daysUntilDeparture)}
                    </p>
                  </button>
                </td>
                {row.cells.map((cell) => (
                  <td
                    key={cell.category}
                    className="px-4 py-4 align-middle text-center"
                  >
                    {cell.percent === null ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <button
                        className="text-sm tabular-nums font-medium hover:underline"
                        style={{ color: undefined }}
                        onClick={() =>
                          onNavigate(mapTabId(cell.tab), row.groupId)
                        }
                      >
                        <span className={TONE_TEXT[percentTone(cell.percent)]}>
                          {cell.percent}%
                        </span>
                      </button>
                    )}
                  </td>
                ))}
                <td className="px-4 py-4 align-middle text-center">
                  <span className="text-sm tabular-nums font-semibold text-foreground">
                    {row.overall}%
                  </span>
                </td>
                <td className="px-4 py-5 align-middle">
                  <div className="flex flex-col gap-1">
                    <ToneBadge
                      tone={readinessStatusTone(row.status)}
                      label={STATUS_LABELS[row.status] ?? row.status}
                      className="w-fit"
                    />
                    <span className="text-[11px] text-muted-foreground max-w-64">
                      {row.primaryBlocker}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

function mapTabId(groupTab: string): OperationsTabId {
  switch (groupTab) {
    case "flights":
      return "flights";
    case "hotels":
      return "accommodation";
    case "transport":
      return "transport";
    case "guide":
      return "guides";
    case "documents":
    case "payments":
      return "tasks";
    default:
      return "overview";
  }
}

export default GroupReadinessTab;
