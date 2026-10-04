"use client";

import { AlertTriangle } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TONE_CLASS, TONE_TEXT, type Tone } from "@/lib/ui/tone";

import type { OperationsBlocker, OperationsTabId } from "../types";
import { daysRemainingLabel } from "../utils";
import SectionHeading from "@/components/section-heading";

const URGENCY_TONE: Record<OperationsBlocker["urgency"], Tone> = {
  CRITICAL: "danger",
  WARNING: "warning",
};

interface OperationsAlertsProps {
  alerts: OperationsBlocker[];
  onOpenTab: (tab: OperationsTabId, filter?: string) => void;
}

const TAB_FOR_GROUP_TAB: Record<string, OperationsTabId> = {
  flights: "flights",
  hotels: "accommodation",
  transport: "transport",
  documents: "tasks",
  payments: "tasks",
  readiness: "readiness",
  guide: "guides",
  pilgrims: "tasks",
  activity: "activity",
};

/** Directly below the KPIs. Only serious operational blockers — capped and
 *  sorted by proximity to departure in `deriveOperationsAlerts()`. */
const OperationsAlerts = ({ alerts, onOpenTab }: OperationsAlertsProps) => {
  const router = useRouter();

  if (alerts.length === 0) return null;

  return (
    <Card className="gap-5">
      <SectionHeading title="Critical Operations Alerts" />
      <div className="flex flex-col gap-3">
        {alerts.map((alert) => {
          const tone = URGENCY_TONE[alert.urgency];
          return (
          <div
            key={alert.id}
            className={cn(
              "flex flex-wrap items-start justify-between gap-3 rounded-md p-3",
              TONE_CLASS[tone],
            )}
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle
                className={cn("size-4 shrink-0 mt-0.5", TONE_TEXT[tone])}
              />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {alert.groupName} ·{" "}
                  {daysRemainingLabel(alert.daysUntilDeparture)}
                </p>
                <p className="text-xs text-muted-foreground">{alert.message}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  router.push(`/departure-groups/${alert.groupId}`)
                }
              >
                Open Group
              </Button>
              <Button
                variant="outline_without_border"
                size="sm"
                onClick={() =>
                  onOpenTab(
                    TAB_FOR_GROUP_TAB[alert.tab] ?? "overview",
                    alert.filter,
                  )
                }
              >
                {alert.actionLabel}
              </Button>
            </div>
          </div>
          );
        })}
      </div>
    </Card>
  );
};

export default OperationsAlerts;
