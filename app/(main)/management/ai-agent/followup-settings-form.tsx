"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupTextarea } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { FOLLOWUP_MAX_DELAYS, FOLLOWUP_MESSAGE_MAX_CHARS } from "@/lib/validations/followups";

import { saveFollowupSettings } from "./actions";
import type { FollowupSettingsRow, FollowupTemplateOption } from "./types";

const NO_TEMPLATE = "NONE";

/** Text field state is kept as strings so a person can clear a box and retype it; it is turned into numbers on save. */
export function FollowupSettingsForm({
  settings,
  templates,
  canEdit,
}: {
  settings: FollowupSettingsRow;
  templates: FollowupTemplateOption[];
  canEdit: boolean;
}) {
  const [followupsEnabled, setFollowupsEnabled] = useState(settings.followups_enabled);
  const [dryRun, setDryRun] = useState(settings.followups_dry_run);
  const [delays, setDelays] = useState(settings.followup_delays_hours.map(String));
  const [messageText, setMessageText] = useState(settings.followup_message_text);
  const [templateId, setTemplateId] = useState(settings.followup_whatsapp_template_id ?? NO_TEMPLATE);
  const [alertMinutes, setAlertMinutes] = useState(String(settings.handoff_alert_minutes));
  const [escalationMinutes, setEscalationMinutes] = useState(String(settings.handoff_escalation_minutes));
  const [submitting, setSubmitting] = useState(false);

  const templateItems = Object.fromEntries([[NO_TEMPLATE, "No template — skip WhatsApp follow-ups after 24 hours"], ...templates.map((template) => [template.id, template.name])]);

  function changeDelay(index: number, value: string) {
    setDelays((current) => current.map((entry, position) => (position === index ? value : entry)));
  }

  async function save() {
    setSubmitting(true);
    const result = await saveFollowupSettings({
      followupsEnabled,
      followupsDryRun: dryRun,
      followupDelaysHours: delays.map((entry) => Number(entry)),
      followupMessageText: messageText,
      followupWhatsappTemplateId: templateId === NO_TEMPLATE ? null : templateId,
      handoffAlertMinutes: Number(alertMinutes),
      handoffEscalationMinutes: Number(escalationMinutes),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.add({ title: "Could not save follow-up settings", description: result.error });
      return;
    }
    toast.add({ title: "Follow-up settings saved" });
  }

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-semibold">Keep customers from slipping away</h3>
        <p className="text-xs text-muted-foreground">
          Tell your team when a customer is waiting for a person, and gently follow up with customers who stopped replying. These settings apply to WhatsApp, Messenger and Instagram.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-semibold">When a customer is waiting for your team</h4>
        <p className="text-xs text-muted-foreground">
          Customers who asked for a person are counted from their first message that nobody has answered. The notification appears in the bell at the top of the page.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InputGroup>
            <InputGroupAddon align="block-start">Tell the assigned person after (minutes)</InputGroupAddon>
            <InputGroupInput type="number" min={1} max={1440} value={alertMinutes} onChange={(event) => setAlertMinutes(event.target.value)} disabled={!canEdit} />
          </InputGroup>
          <InputGroup>
            <InputGroupAddon align="block-start">Tell the Admin and CEO after (minutes)</InputGroupAddon>
            <InputGroupInput type="number" min={1} max={10080} value={escalationMinutes} onChange={(event) => setEscalationMinutes(event.target.value)} disabled={!canEdit} />
          </InputGroup>
        </div>
      </div>

      <div className="border-t pt-4 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-semibold">Follow up with customers who stopped replying</h4>
            <p className="text-xs text-muted-foreground">
              Only chats the assistant is handling get a follow-up. Once a person takes over, or the customer replies, the follow-ups stop.
            </p>
          </div>
          <Switch checked={followupsEnabled} onCheckedChange={setFollowupsEnabled} disabled={!canEdit} aria-label="Send follow-ups to quiet customers" />
        </div>

        <label className="flex items-start gap-2 text-sm rounded-md border p-2.5">
          <Switch checked={dryRun} onCheckedChange={setDryRun} disabled={!canEdit} aria-label="Test mode" />
          <span>
            <span className="font-medium">Test mode</span>
            <span className="block text-xs text-muted-foreground">
              Records the follow-ups that would have been sent but sends nothing to customers. Keep this on until you are happy with the results.
            </span>
          </span>
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">Hours of silence before each follow-up (up to {FOLLOWUP_MAX_DELAYS})</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {delays.map((delay, index) => (
              <InputGroup key={index}>
                <InputGroupAddon align="block-start">Follow-up {index + 1} (hours)</InputGroupAddon>
                <InputGroupInput type="number" min={1} max={720} value={delay} onChange={(event) => changeDelay(index, event.target.value)} disabled={!canEdit} />
              </InputGroup>
            ))}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              {delays.length < FOLLOWUP_MAX_DELAYS && (
                <Button type="button" variant="outline" size="sm" onClick={() => setDelays((current) => [...current, String((Number(current[current.length - 1]) || 0) + 24)])}>
                  Add a follow-up
                </Button>
              )}
              {delays.length > 1 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setDelays((current) => current.slice(0, -1))}>
                  Remove the last follow-up
                </Button>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            The wait is counted from the customer&apos;s last message. Each follow-up must come later than the one before. Messenger and Instagram only allow messages within 24 hours of the customer&apos;s last message, so any follow-up later than that is skipped on those channels.
          </p>
        </div>

        <InputGroup>
          <InputGroupAddon align="block-start">Follow-up message (use {"{name}"} for the customer&apos;s first name)</InputGroupAddon>
          <InputGroupTextarea value={messageText} onChange={(event) => setMessageText(event.target.value)} disabled={!canEdit} rows={3} maxLength={FOLLOWUP_MESSAGE_MAX_CHARS} />
        </InputGroup>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">WhatsApp message to use after 24 hours</label>
          <Select items={templateItems} value={templateId} onValueChange={(value) => setTemplateId(String(value))} disabled={!canEdit}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TEMPLATE}>{templateItems[NO_TEMPLATE]}</SelectItem>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            After 24 hours WhatsApp only lets you send an approved template message, which the customer may be charged for on your account. Only approved templates with at most one variable are listed; the variable is filled with the customer&apos;s first name.
          </p>
        </div>
      </div>

      {canEdit && (
        <div>
          <Button onClick={save} disabled={submitting}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </div>
  );
}
