"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
} from "@/components/ui/input-group";
import {
  Calendar,
  Compass,
  DollarSign,
  Plane,
  Sparkles,
  Users,
} from "lucide-react";
import React from "react";

import type {
  LeadJourneyType,
  LeadPackageRow,
  LeadRoomPreference,
} from "../../types";
import { formatCurrencyLKR, ROOM_PREFERENCE_LABELS } from "../../utils";
import { TONE_BADGE_BORDER, TONE_CLASS } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";
import { ButtonGroup } from "@/components/ui/button-group";

interface LeadTravelInterestProps {
  packages: LeadPackageRow[];
  journeyType: LeadJourneyType;
  onJourneyTypeChange: (value: LeadJourneyType) => void;
  interestedIn: string;
  onInterestedInChange: (value: string) => void;
  packageId: string | null;
  onPackageChange: (value: string | null) => void;
  preferredPeriod: string;
  onPreferredPeriodChange: (value: string) => void;
  adults: number;
  onAdultsChange: (value: number) => void;
  childrenCount: number;
  onChildrenChange: (value: number) => void;
  roomPreference: LeadRoomPreference;
  onRoomPreferenceChange: (value: LeadRoomPreference) => void;
  departureCity: string;
  onDepartureCityChange: (value: string) => void;
  budgetRange: string;
  onBudgetRangeChange: (value: string) => void;
  quotaWaitlistInterest: boolean;
  onQuotaWaitlistInterestChange: (value: boolean) => void;
}

const ROOM_PREFERENCE_CHOICES: LeadRoomPreference[] = [
  "QUAD",
  "TRIPLE",
  "DOUBLE",
  "SINGLE",
  "UNDECIDED",
];

export const INTEREST_OPTIONS: Record<LeadJourneyType, string[]> = {
  UMRAH: [
    "Standard Umrah",
    "Ramadan Umrah",
    "School Holiday Umrah",
    "Private Umrah",
    "VIP Umrah",
  ],
  HAJJ: [
    "Hajj 2027",
    "Hajj 2028",
    "VIP Hajj",
    "Shifting Hajj",
    "Non-Shifting Hajj",
  ],
  EARLY_REGISTRATION: [
    "Hajj 2028 Pre-Registration",
    "Hajj 2029 Pre-Registration",
    "Early Bird Umrah 2027",
  ],
};

export const PERIOD_OPTIONS: Record<LeadJourneyType, string[]> = {
  UMRAH: [
    "Nov 2026",
    "Dec 2026 (School Holidays)",
    "Jan 2027",
    "Ramadan 2027 (First 15 Days)",
    "Ramadan 2027 (Last 10 Days)",
    "Full Ramadan 2027",
    "Flexible / Next Group",
  ],
  HAJJ: ["Hajj 2027 (May/Jun 2027)", "Hajj 2028 (May 2028)", "Hajj 2029"],
  EARLY_REGISTRATION: [
    "2027/2028 Season",
    "2028/2029 Season",
    "Any Upcoming Season",
  ],
};

/** First option of each list, so the form and its reset agree on the default. */
export const DEFAULT_INTEREST: Record<LeadJourneyType, string> = {
  UMRAH: INTEREST_OPTIONS.UMRAH[0],
  HAJJ: INTEREST_OPTIONS.HAJJ[0],
  EARLY_REGISTRATION: INTEREST_OPTIONS.EARLY_REGISTRATION[0],
};

export const DEFAULT_PERIOD: Record<LeadJourneyType, string> = {
  UMRAH: PERIOD_OPTIONS.UMRAH[0],
  HAJJ: PERIOD_OPTIONS.HAJJ[0],
  EARLY_REGISTRATION: PERIOD_OPTIONS.EARLY_REGISTRATION[0],
};

const BUDGET_OPTIONS = [
  "Not discussed",
  "Economy (Under LKR 1.5M)",
  "Standard (LKR 1.5M – 3.0M)",
  "Premium (LKR 3.0M – 5.0M)",
  "VIP (LKR 5.0M+)",
  "Custom range",
];

const DEPARTURE_CITIES = [
  "Colombo",
  "Mattala",
  "Kandy (Group Bus Transfer)",
  "Other",
];

const JOURNEY_CHOICES: { value: LeadJourneyType; label: string }[] = [
  { value: "UMRAH", label: "Umrah" },
  { value: "HAJJ", label: "Hajj" },
  { value: "EARLY_REGISTRATION", label: "Early Registration" },
];

const MAX_TRAVELLERS = 60;

export default function LeadTravelInterest({
  packages,
  journeyType,
  onJourneyTypeChange,
  interestedIn,
  onInterestedInChange,
  packageId,
  onPackageChange,
  preferredPeriod,
  onPreferredPeriodChange,
  adults,
  onAdultsChange,
  childrenCount,
  onChildrenChange,
  roomPreference,
  onRoomPreferenceChange,
  departureCity,
  onDepartureCityChange,
  budgetRange,
  onBudgetRangeChange,
  quotaWaitlistInterest,
  onQuotaWaitlistInterestChange,
}: LeadTravelInterestProps) {
  // Only packages for the chosen journey; an Early Registration enquiry sees
  // the pre-registration lines rather than every package in the catalogue.
  const availablePackages = packages.filter(
    (entry) => entry.journey_type === journeyType,
  );

  const selectedPackageLabel = packageId
    ? (availablePackages.find((p) => p.id === packageId)?.name ??
      "Not decided (custom proposal)")
    : "Not decided (custom proposal)";

  return (
    <div className="no-scrollbar">
      {/* Journey Type toggle */}
      <fieldset className="flex flex-col gap-1.5">
        <InputGroupText>
          {" "}
          Journey Type <span className="text-destructive">*</span>
        </InputGroupText>
        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-sm bg-card  dark:bg-input/10 shadow-sm">
          {JOURNEY_CHOICES.map((choice) => {
            const isSelected = journeyType === choice.value;
            return (
              <button
                key={choice.value}
                aria-pressed={isSelected}
                onClick={() => onJourneyTypeChange(choice.value)}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-sm text-sm font-semibold transition-all duration-200 ${
                  isSelected
                    ? "bg-background text-primary shadow-xs  font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/40"
                }`}
              >
                {/* eslint-disable no-restricted-syntax -- fixed 3-way journey-type legend, not a status/severity signal */}

                {/* eslint-enable no-restricted-syntax */}
                <span>{choice.label}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-4">
        {/* Interested In */}
        <div className="flex flex-col gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup className="cursor-pointer">
                <InputGroupAddon align="block-start">
                  <InputGroupText>
                    Interested In <span className="text-destructive">*</span>
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="lead-interest"
                  value={interestedIn}
                  readOnly
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {INTEREST_OPTIONS[journeyType].map((option) => (
                <DropdownMenuItem
                  key={option}
                  onClick={() => onInterestedInChange(option)}
                >
                  {option}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Preferred Period */}
        <div className="flex flex-col gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup className="cursor-pointer">
                <InputGroupAddon align="block-start">
                  <InputGroupText>Preferred Period / Group</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="lead-period"
                  value={preferredPeriod}
                  readOnly
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {PERIOD_OPTIONS[journeyType].map((option) => (
                <DropdownMenuItem
                  key={option}
                  onClick={() => onPreferredPeriodChange(option)}
                >
                  {option}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Desired Package — full width */}
        <div className="flex flex-col gap-1 md:col-span-2">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup className="cursor-pointer">
                <InputGroupAddon align="block-start">
                  <InputGroupText>
                    <span>Desired Package</span>
                    <span className="ml-1 text-[11px] text-muted-foreground font-normal">
                      — drives the estimated value
                    </span>
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="lead-package"
                  value={selectedPackageLabel}
                  readOnly
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72">
              <DropdownMenuItem onClick={() => onPackageChange(null)}>
                Not decided (custom proposal)
              </DropdownMenuItem>
              {availablePackages.map((entry) => (
                <DropdownMenuItem
                  key={entry.id}
                  onClick={() => onPackageChange(entry.id)}
                >
                  {entry.name} — {formatCurrencyLKR(entry.price_per_person_lkr)}
                  /pax
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Room Preference */}
        <div className="flex flex-col gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup className="cursor-pointer">
                <InputGroupAddon align="block-start">
                  <InputGroupText>Room Preference</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="lead-room-preference"
                  value={ROOM_PREFERENCE_LABELS[roomPreference]}
                  readOnly
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {ROOM_PREFERENCE_CHOICES.map((option) => (
                <DropdownMenuItem
                  key={option}
                  onClick={() => onRoomPreferenceChange(option)}
                >
                  {ROOM_PREFERENCE_LABELS[option]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Departure City */}
        <div className="flex flex-col gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup className="cursor-pointer">
                <InputGroupAddon align="block-start">
                  <InputGroupText>Departure City</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="lead-departure-city"
                  value={departureCity}
                  readOnly
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {DEPARTURE_CITIES.map((option) => (
                <DropdownMenuItem
                  key={option}
                  onClick={() => onDepartureCityChange(option)}
                >
                  {option}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Adult Travellers counter */}
        <div className="flex flex-col gap-1">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Adult Travellers</InputGroupText>
            </InputGroupAddon>
            <ButtonGroup>
              <InputGroupInput
                value={"-"}
                onClick={() => onAdultsChange(Math.max(1, adults - 1))}
                readOnly
                className="flex-1 text-center cursor-pointer"
              />

              <InputGroupInput
                value={`${adults} ${adults === 1 ? "Adult" : "Adults"}`}
                readOnly
                className="text-center flex-3"
              />
              <InputGroupInput
                value={"+"}
                readOnly
                className="flex-1 text-center cursor-pointer"
                onClick={() =>
                  onAdultsChange(Math.min(MAX_TRAVELLERS, adults + 1))
                }
              />
            </ButtonGroup>
          </InputGroup>
        </div>

        {/* Children counter */}
        <div className="flex flex-col gap-1">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Children</InputGroupText>
            </InputGroupAddon>
            <ButtonGroup>
              {" "}
              <InputGroupInput
                value={"-"}
                className="flex-1 cursor-pointer text-center"
                onClick={() => onChildrenChange(Math.max(0, childrenCount - 1))}
                readOnly
              />
              <InputGroupInput
                className="flex-3 text-center"
                value={`${childrenCount} ${childrenCount === 1 ? "Child" : "Children"}`}
                readOnly
              />
              <InputGroupInput
                value={"+"}
                className="flex-1 cursor-pointer text-center"
                onClick={() =>
                  onChildrenChange(Math.min(MAX_TRAVELLERS, childrenCount + 1))
                }
                readOnly
              />
            </ButtonGroup>
          </InputGroup>
        </div>

        {/* Budget Range */}
        <div className="flex flex-col gap-1 md:col-span-2">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup className="cursor-pointer">
                <InputGroupAddon align="block-start">
                  <InputGroupText>Budget Range</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="lead-budget"
                  value={budgetRange}
                  readOnly
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72">
              {BUDGET_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option}
                  onClick={() => onBudgetRangeChange(option)}
                >
                  {option}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Hajj quota waitlist */}
        {journeyType === "HAJJ" && (
          <div className="md:col-span-2 pt-1">
            <label
              className={cn(
                "flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-sm cursor-pointer select-none border",
                TONE_CLASS.warning,
                TONE_BADGE_BORDER.warning,
              )}
            >
              <Checkbox
                checked={quotaWaitlistInterest}
                onCheckedChange={(value) =>
                  onQuotaWaitlistInterestChange(value === true)
                }
              />
              <span>
                Interested in Hajj official quota / waiting list registration
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
