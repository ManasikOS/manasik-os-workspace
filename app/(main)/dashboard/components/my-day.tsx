"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, Check, Circle, Loader2 } from "lucide-react";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/tone-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/animate-ui/components/animate/tabs";
import { toast } from "@/components/ui/toast";
import type { MyDayData, MyDayTask } from "@/lib/types/dashboard";
import { updateOperationsTaskStatusAction } from "@/app/(main)/operations/actions";

type MyDayTab = "overdue" | "due-today" | "upcoming" | "unassigned";

/**
 * "My Day" — a personal work queue, not the agency-wide task list
 * `todays-operation.tsx` used to render (§5.3). Sourced from
 * `loadTasksForStaff(staffId)`, so every row here is owned by the
 * signed-in person, not merely visible to their role.
 */
export default function MyDay({ data }: { data: MyDayData }) {
  const [tab, setTab] = useState<MyDayTab>(data.overdue.length > 0 ? "overdue" : "due-today");
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function complete(task: MyDayTask) {
    setCompletingId(task.id);
    startTransition(async () => {
      const result = await updateOperationsTaskStatusAction({
        id: task.id,
        departureGroupId: task.groupId,
        status: "COMPLETE",
      });
      setCompletingId(null);
      if (!result.ok) {
        toast.add({ title: "Could not complete task", description: result.error });
        return;
      }
      toast.add({ title: "Task completed", description: task.title });
    });
  }

  const tabs: { id: MyDayTab; label: string; count: number }[] = [
    { id: "overdue", label: "Overdue", count: data.overdue.length },
    { id: "due-today", label: "Due Today", count: data.dueToday.length },
    { id: "upcoming", label: "Assigned to Me", count: data.upcoming.length },
  ];
  if (data.unassignedCount !== null) {
    tabs.push({ id: "unassigned", label: "Unassigned", count: data.unassignedCount });
  }

  const rows = tab === "overdue" ? data.overdue : tab === "due-today" ? data.dueToday : tab === "upcoming" ? data.upcoming : [];

  return (
    <Card className="p-5 flex flex-col gap-4 h-full">
      <div>
        <SectionHeading title="My Day" act={null} />
        <p className="text-xs text-muted-foreground mt-0.5">Your open work across every group you own.</p>
      </div>

      <Tabs value={tab} onValueChange={(next) => setTab(next as MyDayTab)}>
        <TabsList className="flex-wrap h-auto">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label} {t.count > 0 ? `(${t.count})` : ""}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === "unassigned" ? (
        <div className="flex flex-col items-start gap-2 py-2">
          <p className="text-sm text-foreground">
            <strong className="font-number">{data.unassignedCount}</strong> task{data.unassignedCount === 1 ? "" : "s"} across the agency
            have no owner.
          </p>
          <Button variant="link" size="sm" className="h-5 p-0 text-xs font-medium" render={<Link href="/operations" />}>
            Open Operations to assign them
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing here." description="You're all caught up." />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((task) => (
            <Card
              key={task.id}
              className="bg-card/50! flex-row items-center justify-between gap-3 p-3"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {tab === "overdue" ? (
                  <AlertTriangle className="size-4 text-destructive shrink-0" />
                ) : (
                  <Circle className="size-3.5 text-muted-foreground shrink-0" />
                )}
                <div className="flex flex-col min-w-0">
                  <Link href={`/departure-groups/${task.groupId}?tab=tasks`} className="text-xs font-medium text-foreground hover:underline truncate">
                    {task.title}
                  </Link>
                  <span className="text-[11px] text-muted-foreground truncate">
                    {task.groupName}
                    {task.daysUntilDeparture !== null ? ` · T-${task.daysUntilDeparture}` : ""} · {task.dueLabel}
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                size="xs"
                className="shrink-0 h-7 text-xs gap-1"
                disabled={isPending && completingId === task.id}
                onClick={() => complete(task)}
              >
                {isPending && completingId === task.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Complete
              </Button>
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}
