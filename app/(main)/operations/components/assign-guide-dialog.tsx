"use client";

import { ChevronDown, Loader2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import { assignGuideAction } from "../actions";
import type { GuidePickerOption } from "../operations-store";
import type { OperationsGuideBoardRow } from "../types";

interface AssignGuideDialogProps {
  group: OperationsGuideBoardRow | null;
  guideOptions: GuidePickerOption[];
  open: boolean;
  onClose: () => void;
}

/**
 * Writes a real `staff_group_assignments` row and syncs
 * `departure_groups.primary_guide_id` — the free-text name input this used
 * to be could not answer "which groups is this guide actually assigned to",
 * which broke `filterGroupsForRole()` the moment a guide's display name
 * changed. See `assignGroupToStaff()` in `lib/data/team-repository.ts`.
 */
const AssignGuideDialog = ({ group, guideOptions, open, onClose }: AssignGuideDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [staffId, setStaffId] = useState("");

  useResetOnOpen(open, group?.groupId ?? "", () => {
    const current = guideOptions.find((g) => g.fullName === group?.primaryGuideName);
    setStaffId(current?.id ?? "");
  });

  if (!group) return null;

  const selectedGuide = guideOptions.find((g) => g.id === staffId);

  const submit = () => {
    if (!staffId) return;
    startTransition(async () => {
      const result = await assignGuideAction({ groupId: group.groupId, staffId });
      if (!result.ok) {
        toast.add({ title: "Could not assign guide", description: result.error });
        return;
      }
      toast.add({ title: `${selectedGuide?.fullName ?? "Guide"} assigned to ${group.groupName}` });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm gap-4">
        <DialogHeader>
          <DialogTitle>Assign Guide</DialogTitle>
          <DialogDescription>{group.groupName}</DialogDescription>
        </DialogHeader>

        <DropdownMenu>
          <DropdownMenuTrigger>
            <InputGroup className="cursor-pointer">
              <InputGroupInput
                readOnly
                value={selectedGuide?.fullName ?? ""}
                placeholder={guideOptions.length === 0 ? "No active guides on record" : "Choose a guide"}
                className="cursor-pointer"
              />
              <ChevronDown className="size-4 text-muted-foreground mr-2" />
            </InputGroup>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-64 max-h-72 overflow-y-auto custom-scroll">
            {guideOptions.length === 0 && <DropdownMenuItem disabled>No active guides on record</DropdownMenuItem>}
            {guideOptions.map((guide) => (
              <DropdownMenuItem key={guide.id} onClick={() => setStaffId(guide.id)}>
                {guide.fullName}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending || !staffId}>
            {isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AssignGuideDialog;
