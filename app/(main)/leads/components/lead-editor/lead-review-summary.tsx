"use client";

import React from "react";
import { MessageSquareText } from "lucide-react";

import type { AddLeadFormData, LeadPackageRow } from "../../types";
import {
  CONTACT_CHANNEL_LABELS,
  FOLLOW_UP_TYPE_LABELS,
  JOURNEY_TYPE_LABELS,
  ROOM_PREFERENCE_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  TEMPERATURE_LABELS,
  formatCurrencyLKR,
  localInputToIso,
} from "../../utils";
import type { StaffRow } from "@/lib/types/leads";
import OpportunityPreviewCard from "./opportunity-preview-card";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import SectionHeading from "@/components/section-heading";
import FormDataLabel from "@/components/ui/form-data-label";

interface LeadReviewSummaryProps {
  formData: AddLeadFormData;
  packages: LeadPackageRow[];
  staffOptions: StaffRow[];
}

/* ── tiny helpers ─────────────────────────────────────────────────────────── */

function Field({
  label,
  value,
  full,
}: {
  label: string;
  value: React.ReactNode;
  full?: boolean;
}) {
  if (!value && value !== 0) return null;
  return (
    <div className={cn("flex flex-col gap-0.5 min-w-0", full && "col-span-2")}>
      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
        {label}
      </span>
      <span className="text-sm font-medium text-foreground leading-tight wrap-break-word">
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <hr className="border-border/40 my-1" />;
}

/* ── date formatter ───────────────────────────────────────────────────────── */
function formatFollowUpDate(localInput: string): string | null {
  const iso = localInputToIso(localInput);
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-LK", {
    timeZone: "Asia/Colombo",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ══════════════════════════════════════════════════════════════════════════ */

export default function LeadReviewSummary({
  formData,
  packages,
  staffOptions,
}: LeadReviewSummaryProps) {
  const assigneeName =
    staffOptions.find((s) => s.id === formData.assignedToId)?.name ?? "—";
  const ownerName =
    staffOptions.find((s) => s.id === formData.followUpOwnerId)?.name ?? "—";

  const selectedPackage = packages.find((p) => p.id === formData.packageId);
  const packageLabel = selectedPackage
    ? `${selectedPackage.name} — ${formatCurrencyLKR(selectedPackage.price_per_person_lkr)}/pax`
    : "Not decided (custom proposal)";

  const followUpDate = formatFollowUpDate(formData.nextFollowUpAt);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Estimated pipeline value ─────────────────────────────────────── */}
      <OpportunityPreviewCard
        packages={packages}
        journeyType={formData.journeyType}
        packageId={formData.packageId}
        roomPreference={formData.roomPreference}
        adults={formData.adults}
        childrenCount={formData.children}
      />

      {/* ── Contact Details ──────────────────────────────────────────────── */}
      <Card className="p-4 flex flex-col pt-3 gap-3">
        <SectionHeading title="Contact Details" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <FormDataLabel label="Full Name" value={formData.fullName || "-"} />
          <FormDataLabel label="Mobile" value={formData.mobile || "-"} />
          <FormDataLabel label="Email" value={formData.email || "-"} />

          <FormDataLabel label="City" value={formData.city || "-"} />

          <FormDataLabel
            label="Language"
            value={formData.preferredLanguage || "-"}
          />
          <FormDataLabel
            label="Preferred Channel"
            value={CONTACT_CHANNEL_LABELS[formData.preferredChannel] || "-"}
          />
        </div>
      </Card>

      <Card className="p-4 flex flex-col pt-3 gap-3">
        <SectionHeading title="Sales Setup" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <FormDataLabel
            label="Lead Source"
            value={SOURCE_LABELS[formData.source]}
          />
          {formData.source === "REFERRAL" && formData.referralName && (
            <FormDataLabel label="Referred By" value={formData.referralName} />
          )}
          {formData.campaignReference && (
            <FormDataLabel
              label="Campaign / Ref"
              value={formData.campaignReference}
            />
          )}
          <FormDataLabel label="Assigned To" value={assigneeName} />
          <FormDataLabel
            label="Pipeline Stage"
            value={STAGE_LABELS[formData.stage]}
          />
          <FormDataLabel
            label="Temperature"
            value={TEMPERATURE_LABELS[formData.temperature]}
          />
        </div>
      </Card>

      {/* ── Travel Interest ──────────────────────────────────────────────── */}
      <Card className="p-4 flex flex-col pt-3 gap-3">
        <SectionHeading title="Travel Interest" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <FormDataLabel
            label="Journey Type"
            value={JOURNEY_TYPE_LABELS[formData.journeyType]}
          />

          <Field label="Interested In" value={formData.interestedIn} />
          <FormDataLabel
            label="Preferred Period"
            value={formData.preferredPeriod}
          />
          <FormDataLabel label="Desired Package" value={packageLabel} />
          <FormDataLabel
            label="Travellers"
            value={`${formData.adults} Adult${formData.adults !== 1 ? "s" : ""}${
              formData.children
                ? ` · ${formData.children} Child${formData.children !== 1 ? "ren" : ""}`
                : ""
            }`}
          />
          <FormDataLabel
            label="Room Preference"
            value={ROOM_PREFERENCE_LABELS[formData.roomPreference]}
          />
          <FormDataLabel
            label="Departure City"
            value={formData.departureCity}
          />
          <FormDataLabel label="Budget Range" value={formData.budgetRange} />
          {formData.quotaWaitlistInterest && (
            <FormDataLabel
              label="Hajj Quota"
              value="Interested in official quota / waitlist registration"
            />
          )}
        </div>
      </Card>

      {/* ── Next Action ──────────────────────────────────────────────────── */}
      <Card className="p-4 flex flex-col pt-3 gap-3">
        <SectionHeading title="Next Action" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <FormDataLabel
            label="Follow-Up Date"
            value={followUpDate?.toString() || "-"}
          />
          <FormDataLabel
            label="Type"
            value={FOLLOW_UP_TYPE_LABELS[formData.followUpType]}
          />
          <FormDataLabel label="Assigned To" value={ownerName} />
        </div>

        {formData.notes && (
          <>
            <Divider />
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                <MessageSquareText className="size-3" />
                Notes
              </span>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {formData.notes}
              </p>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
