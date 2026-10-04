"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

import { parseAiBehaviour, type AiBehaviour } from "@/lib/validations/ai-behaviour";

import { saveAiSettings } from "./actions";
import { AiBehaviourFields } from "./ai-behaviour-fields";
import type { AiSettingsRow } from "./types";

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "si", label: "Sinhala" },
  { value: "ta", label: "Tamil" },
];

const TONE_OPTIONS: { value: AiSettingsRow["tone"]; label: string }[] = [
  { value: "FRIENDLY_PROFESSIONAL", label: "Friendly & Professional" },
  { value: "FORMAL", label: "Formal" },
  { value: "CONCISE", label: "Concise" },
];

export function AiAgentForm({ settings, canEdit }: { settings: AiSettingsRow; canEdit: boolean }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [agentName, setAgentName] = useState(settings.agent_name);
  const [personaInstructions, setPersonaInstructions] = useState(settings.persona_instructions);
  const [languages, setLanguages] = useState<string[]>(settings.languages);
  const [tone, setTone] = useState<AiSettingsRow["tone"]>(settings.tone);
  const [leadCaptureEnabled, setLeadCaptureEnabled] = useState(settings.lead_capture_enabled);
  const [bookingEnabled, setBookingEnabled] = useState(settings.booking_enabled);
  const [handoffEnabled, setHandoffEnabled] = useState(settings.handoff_enabled);
  const [behaviour, setBehaviour] = useState<AiBehaviour>(() => parseAiBehaviour(settings.behaviour));
  const [seatHoldHours, setSeatHoldHours] = useState(settings.seat_hold_hours);
  const [maxTurns, setMaxTurns] = useState(settings.max_turns_per_conversation);
  const [outOfHoursMessage, setOutOfHoursMessage] = useState(settings.out_of_hours_message);

  const [submitting, setSubmitting] = useState(false);

  const toggleLanguage = (value: string) => {
    setLanguages((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  async function save() {
    setSubmitting(true);
    const result = await saveAiSettings({
      enabled,
      agentName,
      personaInstructions,
      languages,
      tone,
      leadCaptureEnabled,
      bookingEnabled,
      handoffEnabled,
      behaviour,
      seatHoldHours,
      maxTurnsPerConversation: maxTurns,
      outOfHoursMessage,
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.add({ title: "Could not save Manasik Copilot settings", description: result.error });
      return;
    }
    toast.add({ title: "Manasik Copilot settings saved" });
  }

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Agent status</h3>
          <p className="text-xs text-muted-foreground">
            When off, messages on every channel still arrive and are stored — the Inbox works as a plain shared inbox,
            they just aren&apos;t answered automatically. Messenger and Instagram also have their own switch under Settings → Integrations, off until you turn it on.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium" htmlFor="agent-name">
            Agent name
          </label>
          <Input id="agent-name" value={agentName} onChange={(e) => setAgentName(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Tone</label>
          <div className="flex gap-3 flex-wrap">
            {TONE_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="tone"
                  checked={tone === option.value}
                  onChange={() => setTone(option.value)}
                  disabled={!canEdit}
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor="persona">
          Persona instructions <span className="text-muted-foreground">(optional — added to every reply&apos;s system prompt)</span>
        </label>
        <Textarea
          id="persona"
          value={personaInstructions}
          onChange={(e) => setPersonaInstructions(e.target.value)}
          disabled={!canEdit}
          rows={3}
          placeholder="e.g. Always mention we specialise in group Umrah packages for families."
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium">Languages</label>
        <div className="flex gap-4">
          {LANGUAGE_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={languages.includes(option.value)}
                onCheckedChange={() => toggleLanguage(option.value)}
                disabled={!canEdit}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>

      <AiBehaviourFields behaviour={behaviour} onChange={setBehaviour} canEdit={canEdit} />

      <div className="border-t pt-4 flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Capabilities</h3>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={leadCaptureEnabled} onCheckedChange={(v) => setLeadCaptureEnabled(Boolean(v))} disabled={!canEdit} />
          Lead capture — create/update a lead from the conversation
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={bookingEnabled}
            onCheckedChange={(v) => setBookingEnabled(Boolean(v))}
            disabled={!canEdit || !leadCaptureEnabled}
          />
          Booking — hold seats on a departure group (never confirms or takes payment)
          {!leadCaptureEnabled && <span className="text-muted-foreground"> — needs lead capture on</span>}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={handoffEnabled} onCheckedChange={(v) => setHandoffEnabled(Boolean(v))} disabled={!canEdit} />
          Handoff — transfer to a staff member when it should
        </label>
      </div>

      <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium" htmlFor="seat-hold-hours">
            Seat hold duration (hours)
          </label>
          <Input
            id="seat-hold-hours"
            type="number"
            min={1}
            value={seatHoldHours}
            onChange={(e) => setSeatHoldHours(Number(e.target.value) || 1)}
            disabled={!canEdit}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium" htmlFor="max-turns">
            Replies per conversation
          </label>
          <Input
            id="max-turns"
            type="number"
            min={1}
            value={maxTurns}
            onChange={(e) => setMaxTurns(Number(e.target.value) || 1)}
            disabled={!canEdit}
          />
          <p className="text-xs text-muted-foreground">
            After this many assistant replies in one chat, the assistant hands the chat to staff.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor="out-of-hours">
          Out-of-hours message <span className="text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id="out-of-hours"
          value={outOfHoursMessage}
          onChange={(e) => setOutOfHoursMessage(e.target.value)}
          disabled={!canEdit}
          rows={2}
        />
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
