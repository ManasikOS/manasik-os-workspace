"use client";

import { CheckCheck, UserPlus } from "lucide-react";
import React, { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

import { bulkUpdateOperationsTasksAction } from "../actions";
import type { OperationsCapabilities, OperationsTaskItem } from "../types";
import ReassignTaskDialog from "./reassign-task-dialog";

interface TaskBulkActionsBarProps {
  selected: OperationsTaskItem[];
  clear: () => void;
  can: OperationsCapabilities;
}

const TaskBulkActionsBar = ({ selected, clear, can }: TaskBulkActionsBarProps) => {
  const [isPending, startTransition] = useTransition();
  const [reassignOpen, setReassignOpen] = useState(false);

  const refs = selected.map((s) => ({ id: s.id, departureGroupId: s.groupId }));

  const completeAll = () => {
    startTransition(async () => {
      const result = await bulkUpdateOperationsTasksAction({ taskIds: refs, status: "COMPLETE" });
      if (!result.ok) {
        toast.add({ title: "Could not complete tasks", description: result.error });
        return;
      }
      toast.add({ title: `${refs.length} task(s) marked complete` });
      clear();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {can.reassignTask && (
        <Button variant="outline_without_border" size="sm" onClick={() => setReassignOpen(true)}>
          <UserPlus /> Bulk Assign
        </Button>
      )}
      {can.bulkUpdateTasks && (
        <Button variant="outline_without_border" size="sm" disabled={isPending} onClick={completeAll}>
          <CheckCheck /> Bulk Update — Mark Complete
        </Button>
      )}

      <ReassignTaskDialog
        taskRefs={refs}
        itemsLabel={`${refs.length} task(s) selected`}
        open={reassignOpen}
        onClose={() => {
          setReassignOpen(false);
          clear();
        }}
      />
    </div>
  );
};

export default TaskBulkActionsBar;
