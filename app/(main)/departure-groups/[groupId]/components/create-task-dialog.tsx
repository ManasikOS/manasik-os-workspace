"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { createGroupTaskSchema } from "@/lib/validations/departure-groups";
import { Loader2, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { createGroupTaskAction } from "../../actions";
import type {
  DepartureGroupListItem,
  DepartureGroupReadinessItem,
  TaskCategory,
} from "../../types";

interface CreateTaskDialogProps {
  group: DepartureGroupListItem;
  /** Requirements this task can be hung off, so the work has a "why". */
  readinessItems: DepartureGroupReadinessItem[];
  open: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  OPERATIONS: "Operations",
  VISA: "Visa",
  FINANCE: "Finance",
  GUIDE: "Guide",
  MARKETING: "Marketing",
  OTHER: "Other",
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as TaskCategory[];

const NO_LINK = "__none__";

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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Creates an ad-hoc task against the group.
 *
 * A task can be linked to a readiness requirement, which is the difference
 * between "someone should chase the hotel" and a chase that is visibly attached
 * to the confirmation the group cannot depart without.
 */
const CreateTaskDialog = ({
  group,
  readinessItems,
  open,
  onClose,
}: CreateTaskDialogProps) => {
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerName, setOwnerName] = useState(
    group.operationsOwnerName ?? group.primaryGuideName ?? "",
  );
  const [dueAt, setDueAt] = useState(defaultDueAt());
  const [category, setCategory] = useState<TaskCategory>("OPERATIONS");
  const [linkedId, setLinkedId] = useState<string>(NO_LINK);
  const [error, setError] = useState<string | null>(null);

  // The dialog stays mounted between opens, so it has to clear each time. The
  // due date in particular is computed relative to *now*, and a tab left open
  // overnight would otherwise offer yesterday's "tomorrow at 17:00".
  useResetOnOpen(open, group.id, () => {
    setTitle("");
    setDescription("");
    setOwnerName(group.operationsOwnerName ?? group.primaryGuideName ?? "");
    setDueAt(defaultDueAt());
    setCategory("OPERATIONS");
    setLinkedId(NO_LINK);
    setError(null);
  });

  const linkedLabel =
    linkedId === NO_LINK
      ? "Not linked"
      : (readinessItems.find((item) => item.id === linkedId)?.label ??
        "Not linked");

  const submit = () => {
    setError(null);

    const due = fromLocalInputValue(dueAt);
    if (!due) {
      setError("Pick a due date and time for this task.");
      return;
    }

    const payload = {
      departureGroupId: group.id,
      title: title.trim(),
      description: description.trim() || null,
      ownerName: ownerName.trim(),
      dueAt: due,
      category,
      linkedReadinessItemId: linkedId === NO_LINK ? null : linkedId,
    };

    const check = createGroupTaskSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "That task is not valid.");
      return;
    }

    startTransition(async () => {
      const result = await createGroupTaskAction(check.data);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Task created",
        description: `${result.title} · assigned to ${ownerName.trim()}`,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl! max-h-[85vh] overflow-y-auto custom-scroll">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
          <DialogDescription>
            {group.groupName} · {group.groupCode}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
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
                <InputGroupText>
                  Owner <span className="text-destructive">*</span>
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                placeholder="Who is doing this?"
              />
            </InputGroup>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Due <span className="text-destructive">*</span>
              </span>
              <Input
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className="font-number"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Category
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup>
                    <InputGroupInput
                      readOnly
                      value={CATEGORY_LABELS[category]}
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-44">
                  {CATEGORIES.map((option) => (
                    <DropdownMenuItem
                      key={option}
                      onClick={() => setCategory(option)}
                    >
                      {CATEGORY_LABELS[option]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Linked requirement
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger disabled={readinessItems.length === 0}>
                  <InputGroup>
                    <InputGroupInput
                      readOnly
                      value={
                        readinessItems.length === 0
                          ? "No checklist on this group"
                          : linkedLabel
                      }
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="min-w-72 max-h-72 overflow-y-auto custom-scroll"
                >
                  <DropdownMenuItem onClick={() => setLinkedId(NO_LINK)}>
                    Not linked
                  </DropdownMenuItem>
                  {readinessItems.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      onClick={() => setLinkedId(item.id)}
                    >
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              isPending ||
              title.trim().length < 3 ||
              ownerName.trim().length === 0
            }
            onClick={submit}
          >
            {isPending && <Loader2 className="animate-spin" />}
            Create Task
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTaskDialog;
