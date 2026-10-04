"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TONE_CLASS, TONE_TEXT, type Tone } from "@/lib/ui/tone";

import type { VisaAlert } from "../types";

interface VisaAlertsProps {
  alerts: VisaAlert[];
  onOpen: (alert: VisaAlert) => void;
}

const ALERT_SEVERITY_TONE: Record<VisaAlert["severity"], Tone> = {
  critical: "danger",
  warning: "warning",
};

/** 3–5 severe issues, directly below the KPIs. Every alert opens a precise
 *  filtered queue rather than a generic application list. */
const VisaAlerts = ({ alerts, onOpen }: VisaAlertsProps) => {
  if (alerts.length === 0) return null;

  return (
    <Card className="gap-3">
      <h3 className="text-sm font-semibold text-foreground">Critical Visa Alerts</h3>
      <div className="flex flex-col gap-2">
        {alerts.map((alert) => {
          const tone = ALERT_SEVERITY_TONE[alert.severity];
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
                className={cn(
                  "size-4 shrink-0 mt-0.5",
                  TONE_TEXT[tone],
                )}
              />
              <div>
                <p className="text-sm font-medium text-foreground">{alert.title}</p>
                <p className="text-xs text-muted-foreground">{alert.detail}</p>
              </div>
            </div>
            <Button variant="outline_without_border" size="sm" onClick={() => onOpen(alert)}>
              {alert.actionLabel}
            </Button>
          </div>
          );
        })}
      </div>
    </Card>
  );
};

export default VisaAlerts;
