"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import InputFormHeader from "@/components/ui/input-form-header";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Search } from "lucide-react";
import React from "react";

import type { LeadListItem } from "../../types";
import { STAGE_LABELS } from "../../utils";
import {
  TONE_BADGE_BORDER,
  TONE_CLASS,
  TONE_STAT_CARD,
  TONE_TEXT,
} from "@/lib/ui/tone";
import { cn } from "@/lib/utils";
import SectionHeading from "@/components/section-heading";
import { ButtonGroup } from "@/components/ui/button-group";

interface DuplicateCheckSectionProps {
  mobile: string;
  onMobileChange: (value: string) => void;
  /** Resolved upstream against the live store, so the whole form sees it. */
  duplicate: { lead: LeadListItem; matchedOn: "mobile" | "email" } | null;
  duplicateReason: string;
  onDuplicateReasonChange: (value: string) => void;
  createAnyway: boolean;
  onCreateAnywayChange: (value: boolean) => void;
}

const DUPLICATE_REASONS = [
  {
    value: "different-enquiry",
    label: "Different travel enquiry (Umrah vs Hajj)",
  },
  { value: "family-member", label: "Family member sharing the same number" },
  { value: "changed-details", label: "Contact details have changed" },
  { value: "staff-verified", label: "Other — staff verified" },
];

export default function DuplicateCheckSection({
  mobile,
  onMobileChange,
  duplicate,
  duplicateReason,
  onDuplicateReasonChange,
  createAnyway,
  onCreateAnywayChange,
}: DuplicateCheckSectionProps) {
  const digits = mobile.replace(/\D/g, "");
  const checked = digits.length >= 9;

  return (
    <div className="flex flex-col gap-3">
      {/* <SectionHeading
        title="Duplicate check"
        act={
          checked && !duplicate ? (
            <span
              className={cn(
                "text-xs font-medium flex items-center gap-1",
                TONE_TEXT.success,
              )}
            >
              <CheckCircle2 className="size-3.5" /> No duplicate found
            </span>
          ) : null
        }
      /> */}

      <div className="flex flex-col gap-2">
        <label htmlFor="duplicate-mobile" className="sr-only">
          Search by mobile number
        </label>
        <InputGroup>
          {/* `type="tel"`, not `type="number"`: a number input rejects spaces,
              eats leading zeros and changes value on scroll. */}
          <ButtonGroup>
            <InputGroupInput value={"+94"} className="flex-1" readOnly />
            <InputGroupInput
              id="duplicate-mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="77 123 4567 — start here to check for an existing lead"
              value={mobile}
              onChange={(event) => onMobileChange(event.target.value)}
              className="text-sm flex-6"
            />
          </ButtonGroup>
        </InputGroup>

        {duplicate && (
          <div
            role="alert"
            className={cn(
              "rounded-md border p-3 text-sm flex flex-col gap-2.5",
              TONE_STAT_CARD.warning,
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div
                className={cn(
                  "flex items-center gap-2 font-semibold text-xs uppercase tracking-wide",
                  TONE_TEXT.warning,
                )}
              >
                <AlertTriangle
                  className={cn("size-4 shrink-0", TONE_TEXT.warning)}
                />
                Existing lead with the same{" "}
                {duplicate.matchedOn === "mobile" ? "mobile" : "email"}
              </div>
              <Badge
                variant="outline"
                className={cn(
                  TONE_CLASS.warning,
                  TONE_BADGE_BORDER.warning,
                  "text-[10px]",
                )}
              >
                {STAGE_LABELS[duplicate.lead.stage]}
              </Badge>
            </div>

            <div
              className={cn(
                "bg-background/60 p-2.5 rounded-sm border text-xs flex flex-col gap-0.5",
                TONE_BADGE_BORDER.warning,
              )}
            >
              <span className="font-semibold text-foreground text-sm">
                {duplicate.lead.name}{" "}
                <span className="font-number text-muted-foreground font-normal">
                  ({duplicate.lead.reference})
                </span>
              </span>
              <span className="text-muted-foreground font-number">
                {duplicate.lead.mobile}
                {duplicate.lead.email ? ` · ${duplicate.lead.email}` : ""}
              </span>
              <span className="text-[11px] text-muted-foreground mt-0.5">
                Owner:{" "}
                <strong className="text-foreground">
                  {duplicate.lead.assignedToName}
                </strong>{" "}
                · Interested in <strong>{duplicate.lead.interestedIn}</strong>
              </span>
            </div>

            <div
              className={cn(
                "flex flex-col gap-2 pt-1 border-t",
                TONE_BADGE_BORDER.warning,
              )}
            >
              <label
                htmlFor="duplicate-reason"
                className={cn("text-xs font-medium", TONE_TEXT.warning)}
              >
                To create a separate lead anyway, choose a reason:
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={duplicateReason}
                  onValueChange={(value) => {
                    onDuplicateReasonChange(value ?? "");
                    // Clearing the reason must also clear the confirmation,
                    // otherwise the override survives half-undone.
                    if (!value) onCreateAnywayChange(false);
                  }}
                >
                  <SelectTrigger id="duplicate-reason" className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="" className="text-xs">
                      — Select duplicate reason —
                    </SelectItem>
                    {DUPLICATE_REASONS.map((reason) => (
                      <SelectItem
                        key={reason.value}
                        value={reason.value}
                        className="text-xs"
                      >
                        {reason.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {duplicateReason && (
                  <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer font-medium select-none">
                    <Checkbox
                      checked={createAnyway}
                      onCheckedChange={(value) =>
                        onCreateAnywayChange(value === true)
                      }
                    />
                    Proceed with creation
                  </label>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
