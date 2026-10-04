"use client";

import React, { useMemo } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PersonChip, ToneBadge } from "@/components/ui/tone-badge";
import SectionHeading from "@/components/section-heading";

import {
  readinessStatusTone,
  supplierStatusTone,
  taskPriorityLabel,
  taskPriorityTone,
  taskStatusTone,
} from "@/lib/data/operations";
import { OVERVIEW_LIST_CAP } from "@/lib/data/operations-copy";

import { useOperations } from "../../operations-store";
import type { OperationsTabId } from "../../types";
import {
  SUPPLIER_STATUS_LABELS,
  TASK_STATUS_LABELS,
  daysRemainingLabel,
  formatDate,
  formatDateTime,
} from "../../utils";
import AiOperationsPanel from "../ai-operations-panel";
import OperationsBlockerCards from "../operations-blocker-cards";
import UpcomingGroupsBoard from "../upcoming-groups-board";

import { ActorChip } from "@/components/ui/copilot-mark";
interface OverviewTabProps {
  onNavigate: (tab: OperationsTabId, filter?: string) => void;
}

const READINESS_LABELS: Record<string, string> = {
  READY: "Ready",
  AT_RISK: "At Risk",
  BLOCKED: "Blocked",
  NOT_STARTED: "Not Started",
};

/** The agency's operational mission control — one screen answering "what
 *  can stop a group from departing, and who owns fixing it?" */
const OverviewTab = ({ onNavigate }: OverviewTabProps) => {
  const { snapshot } = useOperations();

  const pendingSuppliers = useMemo(
    () =>
      [...snapshot.supplierRows]
        .filter((r) => r.status === "NOT_REQUESTED" || r.status === "REQUESTED")
        .sort((a, b) => a.daysUntilDeparture - b.daysUntilDeparture)
        .slice(0, OVERVIEW_LIST_CAP),
    [snapshot.supplierRows],
  );

  const todaysTasks = useMemo(() => {
    const endOfToday = new Date(snapshot.nowIso);
    endOfToday.setHours(23, 59, 59, 999);
    return [...snapshot.tasks]
      .filter(
        (t) =>
          t.status !== "COMPLETE" &&
          Date.parse(t.dueAt) <= endOfToday.getTime(),
      )
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
      .slice(0, OVERVIEW_LIST_CAP + 2);
  }, [snapshot.tasks, snapshot.nowIso]);

  const riskiestGroups = useMemo(
    () =>
      [...snapshot.groups]
        .sort((a, b) => a.readinessScore - b.readinessScore)
        .slice(0, OVERVIEW_LIST_CAP),
    [snapshot.groups],
  );

  const unassigned = useMemo(
    () =>
      snapshot.tasks
        .filter((t) => t.status !== "COMPLETE" && !t.ownerName)
        .slice(0, OVERVIEW_LIST_CAP),
    [snapshot.tasks],
  );

  const recentActivity = useMemo(
    () => snapshot.activity.filter((a) => a.isHighImpact).slice(0, 10),
    [snapshot.activity],
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-6 min-w-0">
        <OperationsBlockerCards onOpenTab={onNavigate} />

        <div>
          <div className="flex items-center justify-between mb-3">
            <SectionHeading title="Upcoming Groups" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate("readiness")}
            >
              View all →
            </Button>
          </div>
          <UpcomingGroupsBoard
            groups={snapshot.groups}
            limit={6}
            onSeeAll={() => onNavigate("readiness")}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card className="gap-3">
            <SectionHeading
              title="Supplier Confirmation Summary"
              act={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate("suppliers")}
                >
                  Open →
                </Button>
              }
            />

            {pendingSuppliers.length === 0 ? (
              <EmptyState
                title="All suppliers confirmed"
                description="Nothing pending across active groups."
              />
            ) : (
              <div className="flex flex-col gap-4">
                {pendingSuppliers.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div>
                      <p className="text-foreground">{s.serviceLabel}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {s.groupName} ·{" "}
                        {daysRemainingLabel(s.daysUntilDeparture)}
                      </p>
                    </div>
                    <ToneBadge
                      tone={supplierStatusTone(s.status)}
                      label={SUPPLIER_STATUS_LABELS[s.status] ?? s.status}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="gap-3">
            <SectionHeading
              title="Today's Operations Tasks"
              act={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate("tasks", "Due Today")}
                >
                  Open →
                </Button>
              }
            />

            {todaysTasks.length === 0 ? (
              <EmptyState
                title="Nothing due today"
                description="The queue is clear for now."
              />
            ) : (
              <div className="flex flex-col gap-4">
                {todaysTasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between text-sm gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground truncate">{t.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t.groupName} · {formatDateTime(t.dueAt)}
                      </p>
                    </div>
                    <ToneBadge
                      tone={taskPriorityTone(
                        taskPriorityLabel(t, snapshot.nowIso),
                      )}
                      label={taskPriorityLabel(t, snapshot.nowIso)}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="gap-3">
            <SectionHeading
              title="Readiness by Group"
              act={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate("readiness")}
                >
                  Open →
                </Button>
              }
            />

            {riskiestGroups.length === 0 ? (
              <EmptyState title="No active groups" />
            ) : (
              <div className="flex flex-col gap-4">
                {riskiestGroups.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div>
                      <p className="text-foreground">{g.groupName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {g.blockers[0]?.message ?? "All clear"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-number text-foreground">
                        {g.readinessScore}%
                      </span>
                      <ToneBadge
                        tone={readinessStatusTone(g.readinessStatus)}
                        label={
                          READINESS_LABELS[g.readinessStatus] ??
                          g.readinessStatus
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="gap-3">
            <SectionHeading
              title="Unassigned Work"
              act={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate("tasks", "Unassigned")}
                >
                  Open →
                </Button>
              }
            />

            {unassigned.length === 0 ? (
              <EmptyState title="Everything has an owner" />
            ) : (
              <div className="flex flex-col gap-4">
                {unassigned.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between text-sm gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground truncate">{t.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t.groupName}
                      </p>
                    </div>
                    <ToneBadge
                      tone={taskStatusTone(t.status)}
                      label={TASK_STATUS_LABELS[t.status] ?? t.status}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card className="gap-3">
          <SectionHeading
            title="Recent Operational Activity"
            act={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNavigate("activity")}
              >
                Open →
              </Button>
            }
          />

          {recentActivity.length === 0 ? (
            <EmptyState title="No high-impact activity yet" />
          ) : (
            <div className="flex flex-col gap-4">
              {recentActivity.map((a) => (
                <div key={a.id} className="flex items-start gap-3 text-sm">
                  <ActorChip name={a.actorName} />
                  <div className="min-w-0">
                    <p className="text-foreground">{a.message}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {a.groupName} · {formatDate(a.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="hidden xl:block">
        <AiOperationsPanel snapshot={snapshot} onOpenTab={onNavigate} />
      </div>
    </div>
  );
};

export default OverviewTab;
