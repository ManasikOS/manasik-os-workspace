"use client";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";

import type { DuplicateLeadSummary } from "@/lib/data/leads-repository";
import { STAGE_LABELS } from "../../utils";
import {
  TONE_BADGE_BORDER,
  TONE_CLASS,
  TONE_STAT_CARD,
  TONE_TEXT,
} from "@/lib/ui/tone";
import { cn } from "@/lib/utils";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card } from "@/components/ui/card";

interface DuplicateCheckSectionProps {
  mobile: string;
  onMobileChange: (value: string) => void;
  /** The existing lead that shares this mobile or email, resolved by the caller. */
  duplicate: {
    lead: DuplicateLeadSummary;
    matchedOn: "mobile" | "email";
  } | null;
  duplicateReason: string;
  onDuplicateReasonChange: (value: string) => void;
  createAnyway: boolean;
  onCreateAnywayChange: (value: boolean) => void;
  /**
   * Where the lookup stands, when the caller looks the lead up asynchronously.
   * Left out when `duplicate` is already known synchronously.
   */
  checkStatus?: "idle" | "checking" | "clear" | "found" | "failed";
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
  checkStatus,
}: DuplicateCheckSectionProps) {
  const digits = mobile.replace(/\D/g, "");
  const checked = digits.length >= 9;
  const isChecking = checkStatus === "checking";
  const checkFailed = checkStatus === "failed";
  const showClear = checked && !duplicate && !isChecking && !checkFailed;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-start flex-col gap-2 w-full">
        <InputGroup className="w-fit">
          <InputGroupAddon align="block-start">
            <InputGroupText>WhatsApp / Mobile Number</InputGroupText>
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
            showClear
              ? cn("font-medium", TONE_TEXT.success)
              : checkFailed
                ? cn("font-medium", TONE_TEXT.warning)
                : "text-muted-foreground",
          )}
        >
          {showClear ? (
            <>
              <CheckCircle2 className="size-3.5" /> No existing lead uses this
              number. You can continue.
            </>
          ) : isChecking ? (
            "Checking for an existing lead…"
          ) : checkFailed ? (
            "We could not check just now. You can continue; the check runs again when you create the lead."
          ) : !checked ? (
            "Enter the mobile number to check whether this person is already in the CRM."
          ) : null}
        </p>

        {duplicate && (
          <Card
            role="alert"
            variant="md-shadow"
            className={cn(
              "p-4 text-sm flex flex-col gap-2.5",
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

            <Card
              variant="md-shadow"
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
            </Card>

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
                <DropdownMenu>
                  <DropdownMenuTrigger
                    id="duplicate-reason"
                    render={<Button type="button" variant="outline" />}
                  >
                    <span
                      className={cn(
                        "truncate text-start",
                        !duplicateReason && "text-muted-foreground",
                      )}
                    >
                      {DUPLICATE_REASONS.find(
                        (reason) => reason.value === duplicateReason,
                      )?.label ?? "Select a reason"}
                    </span>
                    <ChevronDown
                      className="size-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {DUPLICATE_REASONS.map((reason) => (
                      <DropdownMenuItem
                        onClick={() => onDuplicateReasonChange(reason.value)}
                        key={reason.value}
                      >
                        {reason.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

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
          </Card>
        )}
      </div>
    </div>
  );
}
