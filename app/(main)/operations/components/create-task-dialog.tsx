"use client";

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
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { createOperationsTaskAction } from "../actions";
import { useOperations } from "../operations-store";
import { TASK_CATEGORY_LABELS } from "../utils";
import { DateTimePicker } from "@/components/date-time-picker";

interface CreateTaskDialogProps {
  open: boolean;
  onClose: () => void;
  /** Preselects the group when opened from a group-scoped context. */
  defaultGroupId?: string | null;
}

const CATEGORIES = Object.keys(
  TASK_CATEGORY_LABELS,
) as (keyof typeof TASK_CATEGORY_LABELS)[];

/** "2026-09-20T14:30" (local) -> a real ISO string, or null if empty/invalid. */
function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Tomorrow at 17:00 local — a due date that is plausible rather than empty. */
function defaultDueAt(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(17, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Creates an ad-hoc task against any active group — the cross-group
 * counterpart of the Departure Group page's own Create Task dialog. An
 * owner is optional here: an unassigned task is a first-class state on this
 * board ("Unassigned Operations Work"), not an error.
 */
const CreateTaskDialog = ({
  open,
  onClose,
  defaultGroupId,
}: CreateTaskDialogProps) => {
  const { snapshot } = useOperations();
  const [isPending, startTransition] = useTransition();

  const [groupId, setGroupId] = useState<string>(
    defaultGroupId ?? snapshot.groups[0]?.id ?? "",
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [dueAt, setDueAt] = useState(defaultDueAt());
  const [category, setCategory] =
    useState<keyof typeof TASK_CATEGORY_LABELS>("OPERATIONS");
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, defaultGroupId ?? "any", () => {
    setGroupId(defaultGroupId ?? snapshot.groups[0]?.id ?? "");
    setTitle("");
    setDescription("");
    setOwnerName("");
    setDueAt(defaultDueAt());
    setCategory("OPERATIONS");
    setError(null);
  });

  const group = snapshot.groups.find((g) => g.id === groupId);

  const submit = () => {
    setError(null);

    if (!groupId) {
      setError("Choose a departure group.");
      return;
    }
    const due = fromLocalInputValue(dueAt);
    if (!due) {
      setError("Pick a due date and time for this task.");
      return;
    }
    if (title.trim().length < 3) {
      setError("Give the task a title of at least 3 characters.");
      return;
    }

    startTransition(async () => {
      const result = await createOperationsTaskAction({
        departureGroupId: groupId,
        title: title.trim(),
        description: description.trim() || null,
        ownerName: ownerName.trim() || undefined,
        dueAt: due,
        category,
      });

      if (!result.ok) {
        setError(result.error ?? "Could not create the task.");
        return;
      }

      toast.add({
        title: "Task created",
        description: ownerName.trim()
          ? `Assigned to ${ownerName.trim()}`
          : "Left unassigned",
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl! max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
          <DialogDescription>
            A cross-group operational task, owned by whoever should act on it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto custom-scroll flex-1 min-h-0">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>
                    {" "}
                    Departure Group <span className="text-destructive">*</span>
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  readOnly
                  value={
                    group
                      ? `${group.groupName} (${group.groupCode})`
                      : "Choose a group"
                  }
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-72 max-h-72 overflow-y-auto custom-scroll"
            >
              {snapshot.groups.map((g) => (
                <DropdownMenuItem key={g.id} onClick={() => setGroupId(g.id)}>
                  {g.groupName} ({g.groupCode})
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>
                Task <span className="text-destructive">*</span>
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Chase Makkah hotel confirmation"
              autoFocus
            />
          </InputGroup>

          <InputGroup className="overflow-hidden">
            <InputGroupAddon align="block-start">
              <InputGroupText>Description</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What needs doing, and what does done look like?"
              rows={3}
              className="max-h-28 overflow-y-auto"
            />
          </InputGroup>

          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Owner</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                placeholder="Leave blank to leave unassigned"
              />
            </InputGroup>

            <DateTimePicker
              label="Due"
              required
              value={dueAt}
              onChange={setDueAt}
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText> Category</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  readOnly
                  value={TASK_CATEGORY_LABELS[category]}
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              {CATEGORIES.map((option) => (
                <DropdownMenuItem
                  key={option}
                  onClick={() => setCategory(option)}
                >
                  {TASK_CATEGORY_LABELS[option]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {error && (
            <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={isPending || title.trim().length < 3 || !groupId}
            onClick={submit}
          >
            {isPending && <Loader2 className="animate-spin" />}
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTaskDialog;
