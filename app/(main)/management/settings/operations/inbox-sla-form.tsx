"use client";

import { Clock, Timer } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import InputFormCard from "@/components/ui/input-form-card";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import type { QueueCode } from "@/lib/inbox/intelligence/contracts";
import { QUEUE_CATALOGUE } from "@/lib/inbox/queues";
import type { SlaPolicy } from "@/lib/inbox/sla/due-at";
import { SLA_POLICY_QUEUE_CODES } from "@/lib/inbox/sla/policies";
import { FORM_WEEKDAY_ORDER, WEEKDAY_LABELS, type WorkingHoursFormText } from "@/lib/inbox/sla/working-hours-form";

import { SettingToggleRow } from "../components/setting-toggle-row";
import { saveInboxSlaPolicyAction, saveInboxWorkingHoursAction } from "./inbox-sla-actions";

/** Minutes typed as text: blank means "no target". Returns undefined for something that is not a whole number. */
function minutesFromText(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

function InboxWorkingHoursCard({ initial, canEdit }: { initial: WorkingHoursFormText; canEdit: boolean }) {
  const [text, setText] = useState<WorkingHoursFormText>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startSaving] = useTransition();
  const hasHours = FORM_WEEKDAY_ORDER.some((day) => text.days[day].trim() !== "");

  function save() {
    startSaving(async () => {
      setFieldErrors({});
      const result = await saveInboxWorkingHoursAction(text);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast.add({ title: result.error ?? "Working hours were not saved" });
        return;
      }
      toast.add({ title: "Working hours saved" });
    });
  }

  return (
    <InputFormCard
      title="Working hours for reply targets"
      icon={<Clock className="size-4" />}
      desc="Reply targets on a working-hours clock only count time inside these hours. Write each day as 09:00-17:00, and add more ranges after a comma."
    >
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {FORM_WEEKDAY_ORDER.map((day) => (
          <div key={day} className="space-y-1">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>{WEEKDAY_LABELS[day]}</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={text.days[day]}
                placeholder="Closed"
                disabled={!canEdit || pending}
                aria-invalid={fieldErrors[day] ? true : undefined}
                onChange={(event) => setText((current) => ({ ...current, days: { ...current.days, [day]: event.target.value } }))}
              />
            </InputGroup>
            {fieldErrors[day] && <p role="alert" className="text-xs text-destructive">{fieldErrors[day]}</p>}
          </div>
        ))}
        <div className="space-y-1 md:col-span-2">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Days the office is closed (holidays)</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={text.holidays}
              placeholder="2026-12-25, 2027-01-14"
              disabled={!canEdit || pending}
              aria-invalid={fieldErrors.holidays ? true : undefined}
              onChange={(event) => setText((current) => ({ ...current, holidays: event.target.value }))}
            />
          </InputGroup>
          {fieldErrors.holidays && <p role="alert" className="text-xs text-destructive">{fieldErrors.holidays}</p>}
        </div>
      </div>
      {!hasHours && (
        <p className="mt-3 text-xs text-muted-foreground">
          No working hours are saved, so every reply target counts around the clock. Holidays only take effect once at least one day has hours.
        </p>
      )}
      {canEdit && (
        <div className="mt-3 flex justify-end">
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save working hours"}
          </Button>
        </div>
      )}
    </InputFormCard>
  );
}

function InboxQueueTargetRow({ policy, canEdit }: { policy: SlaPolicy; canEdit: boolean }) {
  const [firstReply, setFirstReply] = useState(policy.firstReplyMinutes === null ? "" : String(policy.firstReplyMinutes));
  const [resolution, setResolution] = useState(policy.resolutionMinutes === null ? "" : String(policy.resolutionMinutes));
  const [countsWorkingHoursOnly, setCountsWorkingHoursOnly] = useState(policy.clock === "BUSINESS_HOURS");
  const [opensReview, setOpensReview] = useState(policy.opensInterventionOnBreach);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSaving] = useTransition();
  const label = QUEUE_CATALOGUE[policy.queueCode].label;

  function save() {
    const firstReplyMinutes = minutesFromText(firstReply);
    const resolutionMinutes = minutesFromText(resolution);
    if (firstReplyMinutes === undefined || resolutionMinutes === undefined) {
      setError("Enter whole minutes, or leave a box empty for no target.");
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await saveInboxSlaPolicyAction({
        queueCode: policy.queueCode,
        firstReplyMinutes,
        resolutionMinutes,
        clock: countsWorkingHoursOnly ? "BUSINESS_HOURS" : "ALWAYS",
        opensInterventionOnBreach: opensReview,
      });
      if (!result.ok) {
        setError(result.error ?? "The targets were not saved.");
        return;
      }
      toast.add({ title: `${label} targets saved` });
    });
  }

  return (
    <div className="space-y-2 border-t py-3 first:border-t-0">
      <p className="text-sm font-medium">{label}</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Reply within (minutes)</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput inputMode="numeric" value={firstReply} placeholder="No target" disabled={!canEdit || pending} onChange={(event) => setFirstReply(event.target.value)} />
        </InputGroup>
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Resolve within (minutes)</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput inputMode="numeric" value={resolution} placeholder="No target" disabled={!canEdit || pending} onChange={(event) => setResolution(event.target.value)} />
        </InputGroup>
      </div>
      <SettingToggleRow
        label="Only count working hours"
        description="Off means the clock runs day and night, which suits customers in distress."
        checked={countsWorkingHoursOnly}
        onCheckedChange={setCountsWorkingHoursOnly}
        disabled={!canEdit || pending}
      />
      <SettingToggleRow
        label="Open a review when a reply is overdue"
        description="Off means an overdue reply is only flagged, not raised as a review for the team."
        checked={opensReview}
        onCheckedChange={setOpensReview}
        disabled={!canEdit || pending}
      />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {canEdit && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={save} disabled={pending}>
            {pending ? "Saving…" : `Save ${label}`}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Inbox reply targets — MI2.6. How long each kind of conversation may wait for a reply, on which clock, and whether an
 * overdue reply raises a review. The messaging window of a channel always comes first: a reply is due 2 hours before it
 * closes if that is sooner than the target. Each queue saves on its own.
 */
export function InboxSlaForm({
  policies,
  workingHours,
  canEdit,
}: {
  policies: SlaPolicy[];
  workingHours: WorkingHoursFormText;
  canEdit: boolean;
}) {
  const ordered = SLA_POLICY_QUEUE_CODES.map((code) => policies.find((policy) => policy.queueCode === code)).filter((policy): policy is SlaPolicy => policy !== undefined);
  return (
    <div className="space-y-4">
      <InboxWorkingHoursCard initial={workingHours} canEdit={canEdit} />
      <InputFormCard
        title="Inbox reply targets"
        icon={<Timer className="size-4" />}
        desc="How long a customer may wait, per kind of conversation. A channel's messaging window always comes first: a reply is due 2 hours before it closes if that is sooner."
      >
        <div className="mt-2">
          {ordered.map((policy) => (
            <InboxQueueTargetRow key={policy.queueCode satisfies QueueCode} policy={policy} canEdit={canEdit} />
          ))}
        </div>
      </InputFormCard>
    </div>
  );
}
