"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";

import { TASK_CATEGORY_LABELS } from "@/lib/data/operations-copy";
import type { StaffTaskListItem, TeamMemberProfile } from "@/lib/data/team";

interface TasksWorkloadTabProps {
  profile: TeamMemberProfile;
  tasks: StaffTaskListItem[];
}

/**
 * The four counters come off `team_directory_rows` / `completedThisWeekCount`.
 * The task rows below require `departure_group_tasks.owner_id` to be set,
 * which only happens once a task's free-text "Owner" resolves to a real
 * staff member (`resolveStaffIdByName()` in `lib/data/team-repository.ts`) —
 * so a person with tasks assigned by name only will show the counters above
 * but an empty table here until that resolution catches up.
 */
const TasksWorkloadTab = ({ profile, tasks }: TasksWorkloadTabProps) => {
  const router = useRouter();
  const { member, completedThisWeekCount } = profile;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="gap-1">
          <span className="text-xs text-muted-foreground">Open Tasks</span>
          <span className="text-2xl font-semibold text-foreground">{member.openTaskCount}</span>
        </Card>
        <Card className="gap-1">
          <span className="text-xs text-muted-foreground">Due Today</span>
          <span className="text-2xl font-semibold text-foreground">{member.dueTodayCount}</span>
        </Card>
        <Card className="gap-1">
          <span className="text-xs text-muted-foreground">Overdue</span>
          <span className="text-2xl font-semibold text-foreground">{member.overdueTaskCount}</span>
        </Card>
        <Card className="gap-1">
          <span className="text-xs text-muted-foreground">Completed, Due This Week</span>
          <span className="text-2xl font-semibold text-foreground">{completedThisWeekCount}</span>
        </Card>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="No open tasks with a resolved owner"
          description={`${member.fullName} has no open tasks whose "Owner" field resolved to their account. Tasks assigned by a name that doesn't match exactly stay counted above but won't list here yet.`}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <Card key={task.id} className="gap-2 flex-row items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <ToneBadge tone="neutral" label={task.groupName} />
                  <ToneBadge tone="neutral" label={TASK_CATEGORY_LABELS[task.category] ?? task.category} />
                  {task.isOverdue ? (
                    <ToneBadge tone="danger" label="Overdue" />
                  ) : task.isDueToday ? (
                    <ToneBadge tone="warning" label="Due Today" />
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Due {new Date(task.dueAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => router.push(`/departure-groups/${task.groupId}?tab=readiness`)}>
                Open
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default TasksWorkloadTab;
