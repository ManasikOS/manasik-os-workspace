"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { updateInboxRetentionSettingsAction } from "./data/inbox-retention-actions";

export interface InboxRetentionFormValues { bookingLinkedMessageRetentionYears: number; enquiryMessageRetentionMonths: number; inboxAttachmentRetentionDays: number; voiceAudioRetentionDays: number; intelligenceRetentionMonths: number; aiRunRetentionMonths: number; webhookPayloadRetentionDays: number }
const FIELDS: Array<{ key: keyof InboxRetentionFormValues; label: string; bound: string }> = [
  { key: "bookingLinkedMessageRetentionYears", label: "Booking-linked messages (years)", bound: "Platform bound: 3–10 years" },
  { key: "enquiryMessageRetentionMonths", label: "Unconverted enquiry messages (months)", bound: "Default: 24 months" },
  { key: "inboxAttachmentRetentionDays", label: "Inbox attachments (days)", bound: "Maximum: 365 days" },
  { key: "voiceAudioRetentionDays", label: "Original voice audio (days)", bound: "Maximum: 365 days" },
  { key: "intelligenceRetentionMonths", label: "Conversation intelligence (months)", bound: "Default: 24 months" },
  { key: "aiRunRetentionMonths", label: "AI run audit (months)", bound: "Default: 13 months" },
  { key: "webhookPayloadRetentionDays", label: "Raw webhook payloads (days)", bound: "Maximum: 90 days" },
];

export function InboxRetentionForm({ initial, canEdit }: { initial: InboxRetentionFormValues; canEdit: boolean }) {
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  return <section className="rounded-lg border p-4"><h2 className="text-sm font-semibold">Inbox retention and deletion</h2><p className="mt-1 text-xs text-muted-foreground">Applied nightly and identical on every plan. Promoted documents follow the Documents module policy.</p><div className="mt-4 grid gap-3 md:grid-cols-2">{FIELDS.map((field) => <div key={field.key}><InputGroup><InputGroupAddon align="block-start"><InputGroupText>{field.label}</InputGroupText></InputGroupAddon><InputGroupInput type="number" value={values[field.key]} disabled={!canEdit || pending} onChange={(event) => setValues((current) => ({ ...current, [field.key]: Number(event.target.value) }))} /></InputGroup><p className="mt-1 text-xs text-muted-foreground">{field.bound}</p></div>)}</div>{canEdit && <Button className="mt-4" size="sm" disabled={pending} onClick={() => startTransition(async () => { const result = await updateInboxRetentionSettingsAction(values); toast.add({ title: result.ok ? "Inbox retention saved" : "Could not save Inbox retention", ...(!result.ok ? { description: result.error } : {}) }); })}>Save Inbox retention</Button>}</section>;
}
