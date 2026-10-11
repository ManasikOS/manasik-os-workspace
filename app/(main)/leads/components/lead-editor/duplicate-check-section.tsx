"use client";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { LeadListItem } from "../../types";
import { STAGE_LABELS } from "../../utils";
import {
  TONE_BADGE_BORDER,
  TONE_CLASS,
  TONE_STAT_CARD,
  TONE_TEXT,
} from "@/lib/ui/tone";
import { cn } from "@/lib/utils";
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
      <div className="flex flex-col gap-2">
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>
              <label htmlFor="duplicate-mobile">WhatsApp / Mobile Number</label>
            </InputGroupText>
          </InputGroupAddon>
          {/* `type="tel"`, not `type="number"`: a number input rejects spaces,
              eats leading zeros and changes value on scroll. */}
          <ButtonGroup>
            <InputGroupInput
              value="+94"
              className="flex-1"
              readOnly
              tabIndex={-1}
              aria-label="Country code"
            />
            <InputGroupInput
              id="duplicate-mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="77 123 4567"
              aria-describedby="duplicate-mobile-status"
              value={mobile}
              onChange={(event) => onMobileChange(event.target.value)}
              className="text-sm flex-6"
            />
          </ButtonGroup>
        </InputGroup>

        <p
          id="duplicate-mobile-status"
          aria-live="polite"
          className={cn(
            "text-xs flex items-center gap-1.5",
            checked && !duplicate
              ? cn("font-medium", TONE_TEXT.success)
              : "text-muted-foreground",
          )}
        >
          {checked && !duplicate ? (
            <>
              <CheckCircle2 className="size-3.5" /> No existing lead uses this
              number. You can continue.
            </>
          ) : !checked ? (
            "Enter the mobile number to check whether this person is already in the CRM."
          ) : null}
        </p>

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
                <span className="tabular-nums text-muted-foreground font-normal">
                  ({duplicate.lead.reference})
                </span>
              </span>
              <span className="text-muted-foreground tabular-nums">
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
                    <SelectValue placeholder="Select a reason" />
                  </SelectTrigger>
                  <SelectContent>
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
