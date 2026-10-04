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
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import React, { useState } from "react";

import type { DepartureGroupListItem } from "../types";

export type PendingGroupActionType =
  | "CLOSE_SALES"
  | "REOPEN_SALES"
  | "CANCEL"
  | "ARCHIVE"
  | "MARK_READY"
  | "MARK_DEPARTED"
  | "MARK_COMPLETED"
  | "CLOSE_GROUP";

export interface PendingGroupAction {
  type: PendingGroupActionType;
  group: DepartureGroupListItem;
  /** Collected by the dialog for the actions that require one. */
  reason?: string;
}

interface Copy {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  /** Typing the group code is required for the irreversible ones. */
  requireCodeConfirmation?: boolean;
  /** A free-text reason, kept on the activity trail. */
  requireReason?: boolean;
}

const COPY: Record<PendingGroupActionType, Copy> = {
  CLOSE_SALES: {
    title: "Close sales for this group?",
    description:
      "New bookings will be blocked immediately. Existing bookings, seat holds and the waitlist are unaffected, and sales can be reopened later.",
    confirmLabel: "Close Sales",
    destructive: false,
  },
  REOPEN_SALES: {
    title: "Reopen sales for this group?",
    description:
      "The group returns to the sellable list. Its sales status is set from the seats actually left — selling, limited availability, or waitlist when it is full.",
    confirmLabel: "Reopen Sales",
    destructive: false,
  },
  MARK_READY: {
    title: "Mark this group ready to depart?",
    description:
      "Every required readiness item must be complete — not merely un-blocked. The operational items track the real hotel, flight, payment and document rows, so this certifies the group as it actually stands.",
    confirmLabel: "Mark Ready to Depart",
    destructive: false,
  },
  MARK_DEPARTED: {
    title: "Record this group as departed?",
    description:
      "Sales close permanently, every travelling seat moves to ticketed, and any remaining waitlist is closed. Only do this on the day the group actually flies.",
    confirmLabel: "Record Departure",
    destructive: false,
    requireCodeConfirmation: true,
  },
  MARK_COMPLETED: {
    title: "Mark this group completed?",
    description:
      "Records that the travellers have returned. The group stays open for the final money movements — collect or refund what is outstanding, then close it.",
    confirmLabel: "Mark Completed",
    destructive: false,
  },
  CLOSE_GROUP: {
    title: "Close this group?",
    description:
      "The financial full stop: the group becomes read-only history. It is refused while any booking still owes money or any traveller is awaiting a refund.",
    confirmLabel: "Close Group",
    destructive: true,
    requireCodeConfirmation: true,
  },
  CANCEL: {
    title: "Cancel this departure group?",
    description:
      "Cancelling stops all sales and withdraws every booking on the group: seats and rooming are released, travellers are cancelled, and everything already collected becomes a pending refund. Supplier bookings must still be cancelled with each supplier directly.",
    confirmLabel: "Cancel Group",
    destructive: true,
    requireCodeConfirmation: true,
    requireReason: true,
  },
  ARCHIVE: {
    title: "Archive this departure group?",
    description:
      "The group is removed from the active list and its readiness stops being tracked. Archived groups remain readable and can be restored.",
    confirmLabel: "Archive Group",
    destructive: true,
  },
};

interface ConfirmActionDialogProps {
  pending: PendingGroupAction | null;
  onClose: () => void;
  onConfirmed: (action: PendingGroupAction) => void;
}

/**
 * One confirmation surface for every destructive group action. Irreversible
 * actions additionally require the group code to be typed, so a mis-click on a
 * row menu can never delete a live group.
 */
const ConfirmActionDialog = ({
  pending,
  onClose,
  onConfirmed,
}: ConfirmActionDialogProps) => {
  if (!pending) return null;

  // Keyed so the typed-confirmation field resets when a different group or
  // action is chosen, rather than being cleared by an effect.
  return (
    <ConfirmActionDialogBody
      key={`${pending.type}-${pending.group.id}`}
      pending={pending}
      onClose={onClose}
      onConfirmed={onConfirmed}
    />
  );
};

const ConfirmActionDialogBody = ({
  pending,
  onClose,
  onConfirmed,
}: ConfirmActionDialogProps & { pending: PendingGroupAction }) => {
  const [typedCode, setTypedCode] = useState("");
  const [reason, setReason] = useState("");

  const copy = COPY[pending.type];
  const codeMatches =
    !copy.requireCodeConfirmation ||
    typedCode.trim().toUpperCase() === pending.group.groupCode.toUpperCase();
  const reasonGiven = !copy.requireReason || reason.trim().length >= 3;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="rounded-sm bg-muted/40 px-3 py-2 text-xs">
          <p className="font-medium text-foreground">
            {pending.group.groupName}
          </p>
          <p className="text-muted-foreground font-number mt-0.5">
            {pending.group.groupCode} · {pending.group.bookedSeats} booked ·{" "}
            {pending.group.availableSeats} seats available
          </p>
        </div>

        {copy.requireReason && (
          <InputGroup className="overflow-hidden">
            <InputGroupAddon align="block-start">
              <InputGroupText>
                Reason <span className="text-destructive">*</span>
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this group being cancelled? This is recorded against every withdrawn booking."
              rows={3}
              className="max-h-28 overflow-y-auto"
            />
          </InputGroup>
        )}

        {copy.requireCodeConfirmation && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="confirm-group-code"
              className="text-xs font-medium text-foreground"
            >
              Type{" "}
              <span className="font-number">{pending.group.groupCode}</span> to
              confirm
            </label>
            <Input
              id="confirm-group-code"
              value={typedCode}
              onChange={(event) => setTypedCode(event.target.value)}
              placeholder={pending.group.groupCode}
              autoComplete="off"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {copy.destructive ? "Keep Group" : "Cancel"}
          </Button>
          <Button
            variant={copy.destructive ? "destructive" : "default"}
            disabled={!codeMatches || !reasonGiven}
            onClick={() => {
              onConfirmed({ ...pending, reason: reason.trim() || undefined });
              onClose();
            }}
          >
            {copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConfirmActionDialog;
