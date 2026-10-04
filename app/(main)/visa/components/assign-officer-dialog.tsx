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

import { assignOfficerAction } from "../actions";

interface AssignOfficerDialogProps {
  journeyIds: string[];
  itemsLabel: string;
  currentAssignee?: string | null;
  open: boolean;
  onClose: () => void;
}

const AssignOfficerDialog = ({ journeyIds, itemsLabel, currentAssignee, open, onClose }: AssignOfficerDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");

  useResetOnOpen(open, journeyIds.join(","), () => setName(currentAssignee ?? ""));

  const submit = () => {
    startTransition(async () => {
      const result = await assignOfficerAction({
        journeyIds,
        assignedTo: name.trim() ? "staff" : null,
        assignedToName: name.trim() || null,
      });
      if (!result.ok) {
        toast.add({ title: "Could not assign", description: result.error });
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
          <DialogTitle>Assign visa officer</DialogTitle>
          <DialogDescription>{itemsLabel}</DialogDescription>
        </DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Staff name (leave blank to unassign)" />
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

export default AssignOfficerDialog;
