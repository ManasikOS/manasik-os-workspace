"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/tone-badge";
import { CheckCircle2 } from "lucide-react";
import React from "react";

import type { PilgrimTabId } from "@/lib/access/pilgrims-access";
import type { PilgrimProfile } from "../../../types";
import { JOURNEY_TYPE_LABELS } from "../../../utils";
import SectionHeading from "@/components/section-heading";
import { cn } from "@/lib/utils";
import { TONE_BAR, TONE_TEXT } from "@/lib/ui/tone";

const TONE_DOT: Record<"danger" | "warning" | "info", string> = {
  danger: TONE_BAR.danger,
  warning: TONE_BAR.warning,
  info: TONE_BAR.info,
};

export default function OverviewTab({
  profile,
  onNavigate,
}: {
  profile: PilgrimProfile;
  onNavigate: (tab: PilgrimTabId) => void;
}) {
  const { activeJourney, nextActions } = profile;

  if (!activeJourney) {
    return (
      <EmptyState
        title="No active journey"
        description="This person is not currently enrolled on a departure group."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-4">
        <SectionHeading title="Required Next Actions" />
        {nextActions.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className={cn("size-4", TONE_TEXT.success)} /> Nothing is
            blocking this pilgrim right now.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border/10">
            {nextActions.map((action) => (
              <div
                key={action.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`mt-1.5 size-2 rounded-full shrink-0 ${TONE_DOT[action.tone] ?? "bg-muted-foreground"}`}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm text-foreground">
                      {action.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {action.dueLabel}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline_without_border"
                  size="sm"
                  onClick={() => onNavigate(action.targetTab)}
                >
                  {action.actionLabel}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="gap-4">
        <SectionHeading title="Journey Information" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Journey Type</span>
            <span className="text-foreground">
              {JOURNEY_TYPE_LABELS[activeJourney.journeyType] ??
                activeJourney.journeyType}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">
              Departure Group
            </span>
            <span className="text-foreground">{activeJourney.groupName}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Travel</span>
            <span className="text-foreground">
              {activeJourney.departureDate}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">
              Assigned Guide
            </span>
            <span className="text-foreground">
              {activeJourney.guideName ?? "Not yet assigned"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Branch</span>
            <span className="text-foreground">{activeJourney.branch}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">
              Booking Reference
            </span>
            <span className="text-foreground">
              {activeJourney.bookingReference}
            </span>
          </div>
        </div>
      </Card>

      {profile.journeys.length > 1 && (
        <Card className="gap-3">
          <h3 className="text-sm font-semibold text-foreground">
            Other Journeys
          </h3>
          <div className="flex flex-col divide-y divide-border/40">
            {profile.journeys
              .filter((j) => j.journeyId !== activeJourney.journeyId)
              .map((j) => (
                <div
                  key={j.journeyId}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="text-foreground">{j.groupName}</span>
                  <span className="text-muted-foreground">
                    {j.departureDate}
                  </span>
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}
