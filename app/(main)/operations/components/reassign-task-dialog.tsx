"use client";

import { Loader2 } from "lucide-react";
import React, { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import { bulkUpdateOperationsTasksAction } from "../actions";

interface ReassignTaskDialogProps {
  taskRefs: { id: string; departureGroupId: string }[];
  itemsLabel: string;
  currentOwnerName?: string | null;
  open: boolean;
  onClose: () => void;
}

const ReassignTaskDialog = ({ taskRefs, itemsLabel, currentOwnerName, open, onClose }: ReassignTaskDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");

  useResetOnOpen(open, taskRefs.map((r) => r.id).join(","), () => setName(currentOwnerName ?? ""));

  const submit = () => {
    startTransition(async () => {
      const result = await bulkUpdateOperationsTasksAction({ taskIds: taskRefs, ownerName: name.trim() });
      if (!result.ok) {
        toast.add({ title: "Could not reassign", description: result.error });
        return;
      }
      toast.add({ title: name.trim() ? `Assigned to ${name.trim()}` : "Unassigned" });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm gap-4">
        <DialogHeader>
          <DialogTitle>Reassign task{taskRefs.length > 1 ? "s" : ""}</DialogTitle>
          <DialogDescription>{itemsLabel}</DialogDescription>
        </DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Owner name (leave blank to unassign)" />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReassignTaskDialog;
