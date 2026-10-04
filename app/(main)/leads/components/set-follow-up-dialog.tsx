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
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, CalendarClock } from "lucide-react";
import React, { useState } from "react";

import type { FollowUpType, LeadListItem } from "../types";
import { useLeads } from "../leads-store";
import { FOLLOW_UP_TYPE_LABELS, defaultFollowUpInput, isoToLocalInput, localInputToIso } from "../utils";

interface SetFollowUpDialogProps {
  lead: LeadListItem | null;
  onClose: () => void;
  onSubmit: (input: {
    nextFollowUpAt: string;
    followUpType: FollowUpType;
    followUpOwnerId: string;
  }) => void;
}

/** Schedules or reschedules the next follow-up on its own, without logging a contact. */
const SetFollowUpDialog = ({ lead, onClose, onSubmit }: SetFollowUpDialogProps) => {
  if (!lead) return null;
  return <SetFollowUpForm key={lead.id} lead={lead} onClose={onClose} onSubmit={onSubmit} />;
};

function SetFollowUpForm({
  lead,
  onClose,
  onSubmit,
}: {
  lead: LeadListItem;
  onClose: () => void;
  onSubmit: SetFollowUpDialogProps["onSubmit"];
}) {
  const { staffOptions } = useLeads();
  const [followUpAt, setFollowUpAt] = useState(() =>
    lead.nextFollowUpAt ? isoToLocalInput(lead.nextFollowUpAt) : defaultFollowUpInput(lead.source),
  );
  const [followUpType, setFollowUpType] = useState<FollowUpType>(lead.followUpType ?? "CALL");
  const [ownerId, setOwnerId] = useState(lead.assignedToId);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const iso = localInputToIso(followUpAt);
    if (!iso) {
      setError("Enter a valid date and time.");
      return;
    }
    if (Date.parse(iso) < Date.now()) {
      setError("The next follow-up cannot be in the past.");
      return;
    }
    onSubmit({ nextFollowUpAt: iso, followUpType, followUpOwnerId: ownerId });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" /> Set follow-up
          </DialogTitle>
          <DialogDescription>
            {lead.name} · {lead.reference}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="set-followup-when" className="text-xs font-medium text-foreground">
                When
              </label>
              <InputGroup>
                <InputGroupAddon align="inline-start" className="pl-2.5">
                  <CalendarClock className="size-3.5 text-muted-foreground" />
                </InputGroupAddon>
                <InputGroupInput
                  id="set-followup-when"
                  type="datetime-local"
                  value={followUpAt}
                  onChange={(event) => setFollowUpAt(event.target.value)}
                  className="text-xs"
                />
              </InputGroup>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="set-followup-type" className="text-xs font-medium text-foreground">
                Type
              </label>
              <Select
                value={followUpType}
                onValueChange={(value) => setFollowUpType(value as FollowUpType)}
              >
                <SelectTrigger id="set-followup-type" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(FOLLOW_UP_TYPE_LABELS) as [FollowUpType, string][]).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value} className="text-xs">
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="set-followup-owner" className="text-xs font-medium text-foreground">
              Follow-up owner
            </label>
            <Select value={ownerId} onValueChange={(value) => setOwnerId(value ?? "")}>
              <SelectTrigger id="set-followup-owner" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {staffOptions.map((staff) => (
                  <SelectItem key={staff.id} value={staff.id} className="text-xs">
                    {staff.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p role="alert" className="text-[11px] text-destructive font-medium flex items-center gap-1">
              <AlertCircle className="size-3" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 border-t pt-3 border-border/40">
          <Button variant="outline" onClick={onClose} className="text-xs font-semibold">
            Cancel
          </Button>
          <Button onClick={submit} className="text-xs font-semibold">
            Save follow-up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SetFollowUpDialog;
