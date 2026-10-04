"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ProgressBar, ToneBadge } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";

import { daysBetween } from "@/lib/data/departure-groups-copy";
import type { TeamMemberProfile } from "@/lib/data/team";
import { RESPONSIBILITY_LABELS } from "../../../utils";
import { unassignGroupAction } from "../../../actions";
import AssignGroupDialog from "../../../components/assign-group-dialog";
import type { GroupPickerOption } from "../../../team-store";
import type { TeamCapabilities } from "../../../types";

interface AssignedGroupsTabProps {
  profile: TeamMemberProfile;
  nowIso: string;
  can: TeamCapabilities;
  groupOptions: GroupPickerOption[];
}

const AssignedGroupsTab = ({ profile, nowIso, can, groupOptions }: AssignedGroupsTabProps) => {
  const router = useRouter();
  const { assignments, member } = profile;
  const [assignOpen, setAssignOpen] = useState(false);
  const [unassigningId, setUnassigningId] = useState<string | null>(null);

  const unassign = async (assignmentId: string) => {
    setUnassigningId(assignmentId);
    const result = await unassignGroupAction({ assignmentId });
    setUnassigningId(null);
    if (!result.ok) {
      toast.add({ title: "Could not unassign", description: result.error });
      return;
    }
    toast.add({ title: "Unassigned" });
  };

  return (
    <div className="flex flex-col gap-4">
      {can.assignGroups && (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => setAssignOpen(true)}>
            <Plus /> Assign Departure Group
          </Button>
        </div>
      )}

      {assignments.length === 0 ? (
        <EmptyState title="No Departure Groups assigned" description={`${member.fullName} is not currently assigned to any Departure Group.`} />
      ) : (
        <div className="flex flex-col gap-2">
          {assignments.map((a) => {
            const daysOut = daysBetween(nowIso, a.departureDate);
            return (
              <Card key={a.id} className="gap-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{a.groupName}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <ToneBadge tone="brand" label={RESPONSIBILITY_LABELS[a.responsibility] ?? a.responsibility} />
                      <ToneBadge tone="neutral" label={a.groupCode} />
                    </div>
                    {member.role === "GUIDE" && (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {a.bookedSeats} pilgrims · {daysOut >= 0 ? `Departs in ${daysOut} day${daysOut === 1 ? "" : "s"}` : "Departed"}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2 max-w-52">
                      <ProgressBar percent={a.readinessScore} className="flex-1" />
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">{a.readinessScore}% ready</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {can.assignGroups && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={unassigningId === a.id}
                        onClick={() => unassign(a.id)}
                      >
                        {unassigningId === a.id ? <Loader2 className="animate-spin" /> : <X />}
                        Unassign
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => router.push(`/departure-groups/${a.groupId}`)}>
                      {member.role === "GUIDE" ? "Open Guide Workspace" : "Open Group"}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AssignGroupDialog
        member={assignOpen ? { id: member.id, fullName: member.fullName, role: member.role } : null}
        groupOptions={groupOptions}
        onClose={() => setAssignOpen(false)}
      />
    </div>
  );
};

export default AssignedGroupsTab;
