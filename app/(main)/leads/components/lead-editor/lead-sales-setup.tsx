"use client";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Flame, Tag } from "lucide-react";
import React from "react";

import type { LeadSource, LeadStage, LeadTemperature } from "../../types";
import { useLeads } from "../../leads-store";
import {
  ACTIVE_STAGE_ORDER,
  SOURCE_LABELS,
  STAGE_LABELS,
  TEMPERATURE_LABELS,
  TEMPERATURE_TONES,
} from "../../utils";
import { TONE_BADGE_BORDER, TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

interface LeadSalesSetupProps {
  source: LeadSource;
  onSourceChange: (value: LeadSource) => void;
  campaignReference: string;
  onCampaignReferenceChange: (value: string) => void;
  referralName: string;
  onReferralNameChange: (value: string) => void;
  assignedToId: string;
  onAssignedToChange: (value: string) => void;
  stage: LeadStage;
  onStageChange: (value: LeadStage) => void;
  temperature: LeadTemperature;
  onTemperatureChange: (value: LeadTemperature) => void;
}

/**
 * Stages a brand-new lead may be created in. Booked, Converted and Lost are
 * outcomes, not starting points — a lead cannot be created already lost.
 */
const CREATABLE_STAGES = ACTIVE_STAGE_ORDER.filter(
  (stage) => stage !== "BOOKED",
);

const TEMPERATURE_STYLES: Record<LeadTemperature, string> = {
  HOT: cn(
    TONE_CLASS[TEMPERATURE_TONES.HOT],
    TONE_BADGE_BORDER[TEMPERATURE_TONES.HOT],
    "font-bold border",
  ),
  WARM: cn(
    TONE_CLASS[TEMPERATURE_TONES.WARM],
    TONE_BADGE_BORDER[TEMPERATURE_TONES.WARM],
    "font-bold border",
  ),
  COLD: cn(
    TONE_CLASS[TEMPERATURE_TONES.COLD],
    TONE_BADGE_BORDER[TEMPERATURE_TONES.COLD],
    "font-bold border",
  ),
};

const TEMPERATURE_EMOJI: Record<LeadTemperature, string> = {
  HOT: "🔥",
  WARM: "☀️",
  COLD: "❄️",
};

export default function LeadSalesSetup({
  source,
  onSourceChange,
  campaignReference,
  onCampaignReferenceChange,
  referralName,
  onReferralNameChange,
  assignedToId,
  onAssignedToChange,
  stage,
  onStageChange,
  temperature,
  onTemperatureChange,
}: LeadSalesSetupProps) {
  const { staffOptions } = useLeads();
  return (
    <div className="">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-1">
        <div className="flex flex-col gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>
                    {" "}
                    Lead Source <span className="text-destructive">*</span>
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  value={SOURCE_LABELS[source]}
                  readOnly
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {(Object.entries(SOURCE_LABELS) as [LeadSource, string][]).map(
                ([value, label]) => (
                  <DropdownMenuItem
                    key={value}
                    onClick={() => onSourceChange(value)}
                  >
                    {label}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {source === "REFERRAL" && (
          <div className="flex flex-col gap-1">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Referred By (Pilgrim / Agent)</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="lead-referral"
                type="text"
                placeholder="e.g. Al-Haj Abdul Rahman (LD-2026-0003)"
                value={referralName}
                onChange={(event) => onReferralNameChange(event.target.value)}
                className="text-sm"
              />
            </InputGroup>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>
                <Tag className="size-3 inline-block mr-1 text-muted-foreground" />
                Campaign / Reference
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id="lead-campaign"
              type="text"
              placeholder="e.g. Ramadan 2027 FB Ads"
              value={campaignReference}
              onChange={(event) =>
                onCampaignReferenceChange(event.target.value)
              }
              className="text-sm"
            />
          </InputGroup>
        </div>

        {/* Assigned Owner */}
        <div className="flex flex-col gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup className="cursor-pointer">
                <InputGroupAddon align="block-start">
                  <InputGroupText>
                    Assigned Owner <span className="text-destructive">*</span>
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="lead-owner"
                  value={
                    staffOptions.find((s) => s.id === assignedToId)?.name ??
                    "Select owner"
                  }
                  readOnly
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {staffOptions.map((staff) => (
                <DropdownMenuItem
                  key={staff.id}
                  onClick={() => onAssignedToChange(staff.id)}
                >
                  {staff.name} ({staff.initials})
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Pipeline Stage */}
        <div className="flex flex-col gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup className="cursor-pointer">
                <InputGroupAddon align="block-start">
                  <InputGroupText>Pipeline Stage</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="lead-stage"
                  value={STAGE_LABELS[stage]}
                  readOnly
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {CREATABLE_STAGES.map((value) => (
                <DropdownMenuItem
                  key={value}
                  onClick={() => onStageChange(value)}
                >
                  {STAGE_LABELS[value]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <fieldset className="flex flex-col gap-1 md:col-span-2">
          <InputGroupText>Lead Temperature</InputGroupText>{" "}
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-sm bg-card dark:bg-input/20 shadow-sm ">
            {(["HOT", "WARM", "COLD"] as LeadTemperature[]).map((value) => {
              const isSelected = temperature === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onTemperatureChange(value)}
                  className={`flex border-none items-center justify-center gap-1 py-1 px-2 rounded-xs text-md font-semibold transition-all duration-150 ${
                    isSelected
                      ? TEMPERATURE_STYLES[value]
                      : "text-muted-foreground hover:bg-background/40"
                  }`}
                >
                  {TEMPERATURE_LABELS[value]}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
