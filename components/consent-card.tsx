"use client";

import { useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ShieldCheck } from "lucide-react";

import SectionHeading from "@/components/section-heading";
import { TONE_TEXT } from "@/lib/ui/tone";
import type { ConsentChannel, ConsentStatus } from "@/lib/types/consent";

const CHANNEL_LABELS: Record<ConsentChannel, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  SMS: "SMS",
  CALL: "Call",
};

const STATUS_LABELS: Record<ConsentStatus, string> = {
  UNKNOWN: "Unknown",
  OPTED_IN: "Opted In",
  OPTED_OUT: "Opted Out",
};

export interface ConsentCardProps {
  consentStatus: ConsentStatus;
  consentSource: string | null;
  consentAt: string | null;
  doNotContact: boolean;
  contactableChannels: ConsentChannel[];
  /** False for a role that cannot record a decision — the card still shows status, read-only. */
  canManage: boolean;
  /** Only required when `canManage` — the read-only card never calls this. */
  onSave?: (input: {
    consentStatus: ConsentStatus;
    doNotContact: boolean;
    contactableChannels: ConsentChannel[];
    source: string;
    note?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Shared consent/contactability card — used on both a lead's drawer and a
 * pilgrim's Personal tab, since the fields and the rule are identical on
 * both: consent is UNKNOWN until a staff member records an explicit
 * decision, and do-not-contact is independent of consent status.
 */
export default function ConsentCard({
  consentStatus,
  consentSource,
  consentAt,
  doNotContact,
  contactableChannels,
  canManage,
  onSave,
}: ConsentCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ConsentStatus>(consentStatus);
  const [dnc, setDnc] = useState(doNotContact);
  const [channels, setChannels] = useState<ConsentChannel[]>(contactableChannels);
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setStatus(consentStatus);
    setDnc(doNotContact);
    setChannels(contactableChannels);
    setSource("");
    setNote("");
    setError(null);
    setOpen(true);
  };

  const toggleChannel = (channel: ConsentChannel) => {
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
    );
  };

  const submit = async () => {
    if (!onSave) return;
    if (!source.trim()) {
      setError("Say where this decision came from (e.g. WhatsApp reply, verbal at check-in).");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await onSave({
      consentStatus: status,
      doNotContact: dnc,
      contactableChannels: channels,
      source,
      note: note || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save this decision.");
      return;
    }
    toast.add({ title: "Consent updated" });
    setOpen(false);
    router.refresh();
  };

  return (
    <Card className="gap-2 p-4 pt-2">
      <div className="flex items-center justify-between">
        <SectionHeading title="Consent & Contactability" />
        {canManage && (
          <Button size="sm" variant="ghost" onClick={openDialog}>
            <ShieldCheck className="size-3.5" /> Record Decision
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant={
              consentStatus === "OPTED_IN" ? "default" : consentStatus === "OPTED_OUT" ? "destructive" : "secondary"
            }
          >
            {STATUS_LABELS[consentStatus]}
          </Badge>
          {doNotContact && <Badge variant="destructive">Do Not Contact</Badge>}
          {contactableChannels.map((c) => (
            <Badge key={c} variant="outline">
              {CHANNEL_LABELS[c]}
            </Badge>
          ))}
        </div>
        {consentSource && (
          <p className="text-[11px] text-muted-foreground">
            {consentSource}
            {consentAt && ` · ${new Date(consentAt).toLocaleDateString()}`}
          </p>
        )}
        {consentStatus === "UNKNOWN" && !consentSource && (
          <p className={`text-[11px] ${TONE_TEXT.warning}`}>
            No consent decision has been recorded yet — treat as not contactable for any broadcast or campaign.
          </p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md!">
          <DialogHeader>
            <DialogTitle>Record Consent Decision</DialogTitle>
            <DialogDescription>
              Only record what was actually said or done — never inferred from a reply existing.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Consent status</label>
              <Select value={status} onValueChange={(v) => setStatus(v as ConsentStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNKNOWN">Unknown</SelectItem>
                  <SelectItem value="OPTED_IN">Opted In</SelectItem>
                  <SelectItem value="OPTED_OUT">Opted Out</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Contactable channels</label>
              <div className="flex flex-wrap gap-3">
                {(Object.keys(CHANNEL_LABELS) as ConsentChannel[]).map((c) => (
                  <label key={c} className="flex items-center gap-1.5 text-xs text-foreground">
                    <Checkbox checked={channels.includes(c)} onCheckedChange={() => toggleChannel(c)} />
                    {CHANNEL_LABELS[c]}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <Switch checked={dnc} onCheckedChange={setDnc} />
              Do not contact (overrides any opted-in channel above)
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Source *</label>
              <Input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. WhatsApp reply, verbal at walk-in, website form"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Saving…" : "Save Decision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
