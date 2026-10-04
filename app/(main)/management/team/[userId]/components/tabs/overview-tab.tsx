"use client";

import { Mail, MessageCircle } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/tone-badge";

import type { TeamTabId } from "@/lib/access/team-access";
import type { TeamMemberProfile } from "@/lib/data/team";
import { RESPONSIBILITY_LABELS, WORKLOAD_BAND_LABELS, formatLastActive, workloadBand, workloadTone } from "../../../utils";
import type { TeamCapabilities } from "../../../types";

interface OverviewTabProps {
  profile: TeamMemberProfile;
  nowIso: string;
  can: TeamCapabilities;
  isSelf: boolean;
  onNavigate: (tab: TeamTabId) => void;
}

const OverviewTab = ({ profile, nowIso, onNavigate }: OverviewTabProps) => {
  const router = useRouter();
  const { member, assignments, completedThisWeekCount } = profile;
  const band = workloadBand(member.openTaskCount);

  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Mail className="size-4 text-muted-foreground shrink-0" />
            <span className="text-foreground truncate">{member.email}</span>
          </div>
          {member.whatsapp && (
            <div className="flex items-center gap-2 text-sm">
              <MessageCircle className="size-4 text-muted-foreground shrink-0" />
              <span className="text-foreground truncate">{member.whatsapp}</span>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Last active: {formatLastActive(member, nowIso)}</p>
      </Card>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Work summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="gap-1">
            <span className="text-xs text-muted-foreground">Assigned Departure Groups</span>
            <span className="text-2xl font-semibold text-foreground">{member.assignedGroupCount}</span>
          </Card>
          <Card className="gap-1">
            <span className="text-xs text-muted-foreground">Open Tasks</span>
            <span className="text-2xl font-semibold text-foreground">{member.openTaskCount}</span>
          </Card>
          <Card className="gap-1">
            <span className="text-xs text-muted-foreground">Overdue Tasks</span>
            <span className="text-2xl font-semibold text-foreground">{member.overdueTaskCount}</span>
          </Card>
          <Card className="gap-1">
            <span className="text-xs text-muted-foreground">Completed, Due This Week</span>
            <span className="text-2xl font-semibold text-foreground">{completedThisWeekCount}</span>
          </Card>
          <Card className="gap-1">
            <span className="text-xs text-muted-foreground">Current Workload</span>
            <span className="text-2xl font-semibold text-foreground">{WORKLOAD_BAND_LABELS[band]}</span>
            <ProgressBar percent={Math.min((member.openTaskCount / 13) * 100, 100)} tone={workloadTone(band)} />
          </Card>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assigned groups</h3>
          {assignments.length > 3 && (
            <Button variant="ghost" size="sm" onClick={() => onNavigate("groups")}>
              View all {assignments.length}
            </Button>
          )}
        </div>
        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not assigned to any Departure Group yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {assignments.slice(0, 3).map((a) => (
              <Card key={a.id} className="gap-2 flex-row items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{a.groupName}</p>
                  <p className="text-xs text-muted-foreground">{RESPONSIBILITY_LABELS[a.responsibility] ?? a.responsibility}</p>
                  <div className="flex items-center gap-2 mt-1.5 max-w-40">
                    <ProgressBar percent={a.readinessScore} className="flex-1" />
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">{a.readinessScore}%</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => router.push(`/departure-groups/${a.groupId}`)}>
                  Open Group
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default OverviewTab;
