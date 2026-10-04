"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PersonChip, ToneBadge } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";

import { updateOperationsTaskStatusAction } from "../actions";
import type { OperationsCapabilities, OperationsTaskItem } from "../types";
import {
  TASK_CATEGORY_LABELS,
  TASK_STATUS_LABELS,
  daysRemainingLabel,
  formatDateTime,
  taskPriorityLabel,
  taskPriorityTone,
  taskStatusTone,
} from "../utils";
import ReassignTaskDialog from "./reassign-task-dialog";

interface TaskDrawerProps {
  task: OperationsTaskItem | null;
  open: boolean;
  onClose: () => void;
  can: OperationsCapabilities;
}

const TaskDrawer = ({ task, open, onClose, can }: TaskDrawerProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reassignOpen, setReassignOpen] = useState(false);

  if (!task) return null;

  const toggleComplete = () => {
    startTransition(async () => {
      const result = await updateOperationsTaskStatusAction({
        id: task.id,
        departureGroupId: task.groupId,
        status: task.status === "COMPLETE" ? "OPEN" : "COMPLETE",
      });
      if (!result.ok) {
        toast.add({ title: "Could not update task", description: result.error });
        return;
      }
      toast.add({ title: task.status === "COMPLETE" ? "Task reopened" : "Task marked complete" });
    });
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
        <SheetContent className="sm:max-w-lg overflow-y-auto custom-scroll">
          <SheetHeader>
            <SheetTitle>{task.title}</SheetTitle>
            <SheetDescription>
              {task.groupName} · {daysRemainingLabel(task.daysUntilDeparture)}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-5 px-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Priority</p>
                <ToneBadge tone={taskPriorityTone(taskPriorityLabel(task, new Date().toISOString()))} label={taskPriorityLabel(task, new Date().toISOString())} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Status</p>
                <ToneBadge tone={taskStatusTone(task.status)} label={TASK_STATUS_LABELS[task.status] ?? task.status} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Owner</p>
                <PersonChip name={task.ownerName} fallback="Unassigned" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Category</p>
                <span className="text-sm text-foreground">{TASK_CATEGORY_LABELS[task.category] ?? task.category}</span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Due</p>
                <span className="text-sm text-foreground">{formatDateTime(task.dueAt)}</span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Linked item</p>
                <span className="text-sm text-foreground">{task.linkedReadinessLabel ?? "—"}</span>
              </div>
            </div>

            {task.description && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Description</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{task.description}</p>
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="w-fit -ml-2"
              onClick={() => router.push(`/departure-groups/${task.groupId}`)}
            >
              <ExternalLink /> Open Departure Group
            </Button>
          </div>

          <SheetFooter className="flex-row gap-2">
            {can.completeTask && (
              <Button disabled={isPending} onClick={toggleComplete}>
                {isPending && <Loader2 className="animate-spin" />}
                {task.status === "COMPLETE" ? "Reopen" : "Mark Complete"}
              </Button>
            )}
            {can.reassignTask && (
              <Button variant="outline_without_border" onClick={() => setReassignOpen(true)}>
                Reassign
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ReassignTaskDialog
        taskRefs={[{ id: task.id, departureGroupId: task.groupId }]}
        itemsLabel={task.title}
        currentOwnerName={task.ownerName}
        open={reassignOpen}
        onClose={() => {
          setReassignOpen(false);
          router.refresh();
        }}
      />
    </>
  );
};

export default TaskDrawer;
