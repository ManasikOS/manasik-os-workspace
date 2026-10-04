"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Calendar, MessageSquare } from "lucide-react";
import React, { useState } from "react";

import type { FollowUpType, LeadListItem, LeadStage } from "../types";
import {
  ACTIVE_STAGE_ORDER,
  FOLLOW_UP_TYPE_LABELS,
  STAGE_LABELS,
  defaultFollowUpInput,
  isoToLocalInput,
  localInputToIso,
  nextStage,
} from "../utils";

export interface LogContactSubmission {
  summary: string;
  nextFollowUpAt: string | null;
  followUpType: FollowUpType;
  advanceToStage: LeadStage;
}

interface LogContactDialogProps {
  lead: LeadListItem | null;
  onClose: () => void;
  onSubmit: (lead: LeadListItem, submission: LogContactSubmission) => void;
}

/**
 * Records what was said and re-arms the follow-up in the same step.
 *
 * Leaving a lead with no next action is the main way a pipeline rots, so the
 * dialog schedules one by default and makes clearing it a deliberate choice.
 */
const LogContactDialog = ({ lead, onClose, onSubmit }: LogContactDialogProps) => {
  if (!lead) return null;
  // Keyed on the lead, so opening a different one remounts the form rather than
  // resetting it from an effect — no cascading render, and no chance of the
  // previous lead's half-typed note surviving.
  return <LogContactForm key={lead.id} lead={lead} onClose={onClose} onSubmit={onSubmit} />;
};

function LogContactForm({
  lead,
  onClose,
  onSubmit,
}: {
  lead: LeadListItem;
  onClose: () => void;
  onSubmit: (lead: LeadListItem, submission: LogContactSubmission) => void;
}) {
  const [summary, setSummary] = useState("");
  const [scheduleNext, setScheduleNext] = useState(true);
  const [followUpAt, setFollowUpAt] = useState(() =>
    // Keep an existing future slot; otherwise propose the source's default.
    lead.nextFollowUpAt && (lead.daysUntilFollowUp ?? -1) >= 0
      ? isoToLocalInput(lead.nextFollowUpAt)
      : defaultFollowUpInput(lead.source),
  );
  const [followUpType, setFollowUpType] = useState<FollowUpType>(
    lead.followUpType ?? "CALL",
  );
  const [stage, setStage] = useState<LeadStage>(
    () => nextStage(lead.stage) ?? lead.stage,
  );
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!summary.trim()) {
      setError("Add a short note describing the contact.");
      return;
    }

    const iso = scheduleNext ? localInputToIso(followUpAt) : null;
    if (scheduleNext && !iso) {
      setError("Enter a valid follow-up date and time.");
      return;
    }
    if (iso && Date.parse(iso) < Date.now()) {
      setError("The next follow-up cannot be in the past.");
      return;
    }

    onSubmit(lead, {
      summary,
      nextFollowUpAt: iso,
      followUpType,
      advanceToStage: stage,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="size-4 text-primary" /> Log contact
          </DialogTitle>
          <DialogDescription>
            {lead.name} · {lead.reference}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="log-contact-summary"
              className="text-xs font-medium text-foreground"
            >
              What happened? <span className="text-destructive">*</span>
            </label>
            <InputGroup className="h-24">
              <InputGroupTextarea
                id="log-contact-summary"
                rows={3}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="e.g. Called and shared the 14-day Executive quote. Wants to confirm with family this week."
                className="text-xs p-2.5"
              />
            </InputGroup>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="log-contact-stage"
              className="text-xs font-medium text-foreground"
            >
              Move to stage
            </label>
            <Select
              value={stage}
              onValueChange={(value) => setStage(value as LeadStage)}
            >
              <SelectTrigger id="log-contact-stage" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVE_STAGE_ORDER.map((entry) => (
                  <SelectItem key={entry} value={entry} className="text-xs">
                    {STAGE_LABELS[entry]}
                    {entry === lead.stage ? " (no change)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none">
            <Checkbox
              checked={scheduleNext}
              onCheckedChange={(checked) => setScheduleNext(checked === true)}
            />
            Schedule the next follow-up
          </label>

          {scheduleNext && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="log-contact-when"
                  className="text-xs font-medium text-foreground"
                >
                  When
                </label>
                <InputGroup>
                  <InputGroupAddon align="inline-start" className="pl-2.5">
                    <Calendar className="size-3.5 text-muted-foreground" />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="log-contact-when"
                    type="datetime-local"
                    value={followUpAt}
                    onChange={(event) => setFollowUpAt(event.target.value)}
                    className="text-xs"
                  />
                </InputGroup>
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="log-contact-type"
                  className="text-xs font-medium text-foreground"
                >
                  Type
                </label>
                <Select
                  value={followUpType}
                  onValueChange={(value) =>
                    setFollowUpType(value as FollowUpType)
                  }
                >
                  <SelectTrigger id="log-contact-type" className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.entries(FOLLOW_UP_TYPE_LABELS) as [
                        FollowUpType,
                        string,
                      ][]
                    ).map(([value, label]) => (
                      <SelectItem key={value} value={value} className="text-xs">
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {!scheduleNext && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <AlertCircle className="size-3" />
              This lead will show as having no follow-up scheduled.
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="text-[11px] text-destructive font-medium flex items-center gap-1"
            >
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
            Save contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LogContactDialog;
