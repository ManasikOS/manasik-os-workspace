"use client";

import { TriangleAlert } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroupInput } from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { TONE_CLASS } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

import type { GroupSalesStatus } from "../../types";
import { SALES_STATUS_LABELS } from "../../utils";
import { DateField, Field, SelectMenu } from "./group-editor-fields";
import {
  COPY_LABELS,
  SALES_STATUSES,
  SEAT_HOLD_CHOICES,
} from "./group-editor-model";
import type { GroupEditorForm } from "./use-group-editor-form";

interface StepDetailsProps {
  form: GroupEditorForm;
  /** Whether to show what is missing on the required fields. */
  showErrors: boolean;
}

/** Step 2: the handful of facts that are genuinely specific to this group. */
export default function StepDetails({ form, showErrors }: StepDetailsProps) {
  const { details, setDetail, selected, serverErrors } = form;

  const fieldError = (key: string, missing: boolean, message: string) =>
    serverErrors[key]?.[0] ?? (showErrors && missing ? message : undefined);

  const durationLabel =
    form.durationDays === null
      ? null
      : `${form.durationDays} days / ${Math.max(form.durationDays - 1, 0)} nights`;

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-4">
        <h3 className="text-base font-medium">Group details</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Group name"
            required
            error={fieldError("groupName", !details.groupName.trim(), "Enter a group name.")}
            className="sm:col-span-2"
          >
            <InputGroupInput
              value={details.groupName}
              onChange={(event) => setDetail("groupName", event.target.value)}
              placeholder="August Umrah Group 04"
              aria-invalid={!details.groupName.trim() && showErrors ? true : undefined}
            />
          </Field>

          <Field
            label="Group code"
            required
            error={serverErrors.groupCode?.[0]}
            hint={
              form.isGeneratingCode
                ? "Generating a unique code…"
                : "Generated automatically. Uniqueness is checked again on save."
            }
          >
            <InputGroupInput
              value={form.isGeneratingCode ? "Generating…" : details.groupCode}
              readOnly
              className="cursor-not-allowed tabular-nums text-muted-foreground"
            />
          </Field>

          <Field label="Branch" required error={serverErrors.branch?.[0]}>
            <SelectMenu
              value={details.branch}
              options={form.branchChoices.map((branch) => ({
                value: branch,
                label: branch,
              }))}
              onChange={(value) => setDetail("branch", value)}
            />
          </Field>

          <DateField
            label="Departure date"
            required
            value={details.departureDate}
            onSelect={(date) => {
              setDetail("departureDate", date);
              // Keep the return date from silently sitting before it.
              if (date > details.returnDate) setDetail("returnDate", date);
            }}
          />
          <DateField
            label="Return date"
            required
            value={details.returnDate}
            disabledBefore={details.departureDate}
            onSelect={(date) => setDetail("returnDate", date)}
          />

          {durationLabel ? (
            <p className="-mt-2 text-[11px] text-muted-foreground sm:col-span-2">
              {durationLabel}
            </p>
          ) : null}

          {form.durationMismatch !== null && selected ? (
            <div
              role="status"
              className={cn(
                "flex items-start gap-2 rounded-sm px-2.5 py-2 text-xs sm:col-span-2",
                TONE_CLASS.warning,
              )}
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                These dates span {form.durationMismatch} day
                {form.durationMismatch === 1 ? "" : "s"}, but {selected.name} is a{" "}
                {selected.durationDays}-day template. The accommodation blocks
                copied from it are laid out for {selected.durationDays} days.
                Check and adjust them on the group after it is created.
              </span>
            </div>
          ) : null}

          <Field
            label="Capacity"
            required
            error={fieldError("capacity", !details.capacity, "Enter the group's capacity.")}
          >
            <InputGroupInput
              type="number"
              inputMode="numeric"
              min={1}
              value={details.capacity}
              onChange={(event) => setDetail("capacity", event.target.value)}
              className="tabular-nums"
              aria-invalid={!details.capacity && showErrors ? true : undefined}
            />
          </Field>

          <Field label="Minimum group size" error={serverErrors.minimumGroupSize?.[0]}>
            <InputGroupInput
              type="number"
              inputMode="numeric"
              min={0}
              value={details.minimumGroupSize}
              onChange={(event) => setDetail("minimumGroupSize", event.target.value)}
              className="tabular-nums"
            />
          </Field>

          <Field label="Sales status" required error={serverErrors.salesStatus?.[0]}>
            <SelectMenu
              value={details.salesStatus}
              options={SALES_STATUSES.map((status) => ({
                value: status,
                label: SALES_STATUS_LABELS[status],
              }))}
              onChange={(value) => setDetail("salesStatus", value as GroupSalesStatus)}
            />
          </Field>

          <Field label="Seat hold expiry">
            <SelectMenu
              value={String(details.seatHoldExpiryHours)}
              options={SEAT_HOLD_CHOICES.map((hours) => ({
                value: String(hours),
                label: `${hours} hours`,
              }))}
              onChange={(value) => setDetail("seatHoldExpiryHours", Number(value))}
            />
          </Field>

          <Field label="Primary operations owner">
            <InputGroupInput
              value={details.operationsOwnerName}
              onChange={(event) => setDetail("operationsOwnerName", event.target.value)}
              placeholder="M. Rameez"
            />
          </Field>

          <Field label="Primary guide" hint="Optional. Can be assigned later.">
            <InputGroupInput
              value={details.primaryGuideName}
              onChange={(event) => setDetail("primaryGuideName", event.target.value)}
              placeholder="Imran R."
            />
          </Field>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border/50 px-4 py-3 sm:col-span-2">
            <div>
              <p className="text-sm font-medium">Waitlist enabled</p>
              <p className="text-xs text-muted-foreground">
                Accept waitlist requests once the group is full.
              </p>
            </div>
            <Switch
              checked={details.waitlistEnabled}
              onCheckedChange={(checked) => setDetail("waitlistEnabled", checked)}
              aria-label="Waitlist enabled"
            />
          </div>
        </div>
      </Card>

      <Card className="gap-3">
        <div>
          <h3 className="text-base font-medium">
            Copy from {selected?.name ?? "the template"}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Copied values become this group&apos;s own. Later edits to the
            template will not change them.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {COPY_LABELS.map(({ key, label }) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2.5 text-sm"
            >
              <Checkbox
                checked={form.copyOptions[key]}
                onCheckedChange={(checked) =>
                  form.setCopyOptions((previous) => ({
                    ...previous,
                    [key]: checked === true,
                  }))
                }
              />
              {label}
            </label>
          ))}
        </div>
      </Card>
    </div>
  );
}
