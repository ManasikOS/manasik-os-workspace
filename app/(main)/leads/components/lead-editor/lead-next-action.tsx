"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { AlertCircle, MessageSquareText } from "lucide-react";
import React from "react";

import type { FollowUpType } from "../../types";
import type { StaffRow } from "@/lib/types/leads";
import { FOLLOW_UP_TYPE_LABELS } from "../../utils";
import { DateTimePicker } from "@/components/date-time-picker";

interface LeadNextActionProps {
  /** Who a follow-up task can be given to. */
  staffOptions: StaffRow[];
  nextFollowUpAt: string;
  onNextFollowUpAtChange: (value: string) => void;
  followUpType: FollowUpType;
  onFollowUpTypeChange: (value: FollowUpType) => void;
  followUpOwnerId: string;
  onFollowUpOwnerChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  errors: Record<string, string>;
}

export default function LeadNextAction({
  staffOptions,
  nextFollowUpAt,
  onNextFollowUpAtChange,
  followUpType,
  onFollowUpTypeChange,
  followUpOwnerId,
  onFollowUpOwnerChange,
  notes,
  onNotesChange,
  errors,
}: LeadNextActionProps) {
  const selectedStaffName =
    staffOptions.find((s) => s.id === followUpOwnerId)?.name ?? "Select owner";

  const followUpTypeLabel =
    (FOLLOW_UP_TYPE_LABELS as Record<string, string>)[followUpType] ??
    followUpType;

  return (
    <div className="">
      {/* Every new lead needs a next follow-up: the server rejects a lead without one. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Follow-up date/time */}
        <div className="flex flex-col gap-1">
          <DateTimePicker
            value={nextFollowUpAt}
            label={"Next Follow-up"}
            onChange={(event) => onNextFollowUpAtChange(event)}
          />
          {errors.nextFollowUpAt && (
            <span
              id="lead-followup-error"
              className="text-[11px] text-destructive font-medium flex items-center gap-1"
            >
              <AlertCircle className="size-3" />
              {errors.nextFollowUpAt}
            </span>
          )}
        </div>

        {/* Follow-up Type */}
        <div className="flex flex-col gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup className="cursor-pointer">
                <InputGroupAddon align="block-start">
                  <InputGroupText>Follow-Up Type</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="lead-followup-type"
                  value={followUpTypeLabel}
                  readOnly
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {(
                Object.entries(FOLLOW_UP_TYPE_LABELS) as [
                  FollowUpType,
                  string,
                ][]
              ).map(([value, label]) => (
                <DropdownMenuItem
                  key={value}
                  onClick={() => onFollowUpTypeChange(value)}
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Task Owner */}
        <div className="flex flex-col gap-1 md:col-span-2">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup className="cursor-pointer">
                <InputGroupAddon align="block-start">
                  <InputGroupText>Follow-Up Task Owner</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="lead-followup-owner"
                  value={selectedStaffName}
                  readOnly
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {staffOptions.map((staff) => (
                <DropdownMenuItem
                  key={staff.id}
                  onClick={() => onFollowUpOwnerChange(staff.id)}
                >
                  {staff.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Notes — always visible */}
      <div className="flex flex-col gap-1 mt-4">
        <InputGroup className="h-28">
          <InputGroupAddon align="block-start">
            <InputGroupText>Initial Enquiry / Internal Notes</InputGroupText>
          </InputGroupAddon>
          <InputGroupTextarea
            id="lead-notes"
            rows={4}
            placeholder="e.g. Travelling with spouse; asks about instalment plans; prefers a 14-day package."
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            className="text-xs p-2.5"
          />
        </InputGroup>
      </div>
    </div>
  );
}
