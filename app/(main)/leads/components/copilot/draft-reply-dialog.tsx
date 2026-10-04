"use client";

/**
 * Draft Customer Reply — generated on the server from confirmed,
 * customer-facing Package/Group data only. Editable, copyable, savable as a
 * draft. Never sent from here.
 */

import { Copy, Loader2 } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { defaultIncludesFor } from "@/lib/copilot/sales/content-generation";
import type {
  ReasoningSource,
  ReplyIncludes,
  ReplyLanguage,
  ReplyPurpose,
  ReplyTone,
  TravelIntent,
} from "@/lib/copilot/sales/types";
import { TONE_STAT_CARD, TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

import { draftCustomerReplyAction, saveReplyDraftAction, type DraftReplyResult } from "../../copilot-actions";
import type { LeadListItem } from "../../types";
import { ChoiceSelect, FieldLabel, SectionLabel, SourceNote, type Choice } from "./offer-parts";

interface DraftReplyDialogProps {
  lead: LeadListItem;
  offerId: string | null;
  workingIntent: TravelIntent | null;
  initialPurpose: ReplyPurpose;
  initialLanguage?: ReplyLanguage;
  /** An Ask Manasik answer to keep in view while writing (internal). */
  reference: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const PURPOSES: Choice<ReplyPurpose>[] = [
  { value: "OFFER_RECOMMENDATION", label: "Offer recommendation" },
  { value: "PACKAGE_EXPLANATION", label: "Package explanation" },
  { value: "PRICE_AND_ROOMS", label: "Price and room options" },
  { value: "INSTALMENT_PLAN", label: "Instalment plan explanation" },
  { value: "COMPARISON", label: "Comparison reply" },
  { value: "DEPARTURE_DATE", label: "Departure-date answer" },
  { value: "GENERAL", label: "General reply" },
];

const TONES: Choice<ReplyTone>[] = [
  { value: "WARM", label: "Warm and respectful" },
  { value: "PROFESSIONAL", label: "Professional" },
  { value: "SHORT_WHATSAPP", label: "Short WhatsApp" },
  { value: "DETAILED", label: "Detailed package explanation" },
];

const LANGUAGES: Choice<ReplyLanguage>[] = [
  { value: "EN", label: "English" },
  { value: "SI", label: "Sinhala" },
  { value: "TA", label: "Tamil" },
];

const TOGGLES: { key: keyof ReplyIncludes; label: string }[] = [
  { key: "group", label: "Recommended group" },
  { key: "dates", label: "Travel dates" },
  { key: "room", label: "Room option" },
  { key: "price", label: "Price" },
  { key: "paymentPlan", label: "Deposit / payment plan" },
  { key: "inclusions", label: "Major inclusions" },
  { key: "comparison", label: "Comparison" },
  { key: "missingQuestions", label: "Ask missing questions" },
];

function languageFor(preferred: string): ReplyLanguage {
  if (/tamil/i.test(preferred)) return "TA";
  if (/sinhala/i.test(preferred)) return "SI";
  return "EN";
}

export default function DraftReplyDialog({
  lead,
  offerId,
  workingIntent,
  initialPurpose,
  initialLanguage,
  reference,
  onClose,
  onSaved,
}: DraftReplyDialogProps) {
  const [purpose, setPurpose] = useState<ReplyPurpose>(initialPurpose);
  const [tone, setTone] = useState<ReplyTone>("WARM");
  const [language, setLanguage] = useState<ReplyLanguage>(initialLanguage ?? languageFor(lead.preferredLanguage));
  const [include, setInclude] = useState<ReplyIncludes>(defaultIncludesFor(initialPurpose));
  const [text, setText] = useState("");
  const [source, setSource] = useState<ReasoningSource>("RULES");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(true);
  const [saving, setSaving] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const applyResult = (result: DraftReplyResult) => {
    setGenerating(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setText(result.text);
    setSource(result.source);
    setWarnings(result.warnings);
  };

  const request = (next: { purpose: ReplyPurpose; tone: ReplyTone; language: ReplyLanguage; include: ReplyIncludes }) =>
    draftCustomerReplyAction({ leadId: lead.id, offerId, intentOverride: workingIntent, ...next });

  // The first draft is generated on open; later drafts only on "Regenerate".
  useEffect(() => {
    let cancelled = false;
    request({ purpose: initialPurpose, tone: "WARM", language: initialLanguage ?? languageFor(lead.preferredLanguage), include: defaultIncludesFor(initialPurpose) }).then(
      (result) => {
        if (!cancelled) applyResult(result);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first draft only
  }, []);

  const regenerate = async () => {
    setGenerating(true);
    applyResult(await request({ purpose, tone, language, include }));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.add({ title: "Reply copied" });
    } catch {
      toast.add({ title: "Could not copy", description: "Your browser blocked clipboard access." });
    }
  };

  const save = async () => {
    setSaving(true);
    const result = await saveReplyDraftAction({ leadId: lead.id, body: text, purpose, tone, language, offerId });
    setSaving(false);
    if (!result.ok) {
      toast.add({ title: "Could not save draft", description: result.error });
      return;
    }
    toast.add({ title: "Draft saved", description: "Saved on the lead — not sent." });
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Draft Customer Reply</DialogTitle>
          <DialogDescription>
            {lead.name} · {lead.reference}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="reply-purpose">Purpose</FieldLabel>
            <ChoiceSelect
              id="reply-purpose"
              value={purpose}
              choices={PURPOSES}
              onChange={(value) => {
                setPurpose(value);
                setInclude(defaultIncludesFor(value));
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="reply-tone">Tone</FieldLabel>
            <ChoiceSelect id="reply-tone" value={tone} choices={TONES} onChange={setTone} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="reply-language">Language</FieldLabel>
            <ChoiceSelect id="reply-language" value={language} choices={LANGUAGES} onChange={setLanguage} />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5">
          {TOGGLES.map((toggle) => (
            <label key={toggle.key} className="flex items-center gap-2 text-xs text-foreground">
              <Checkbox
                checked={include[toggle.key]}
                onCheckedChange={(checked) => setInclude((current) => ({ ...current, [toggle.key]: checked === true }))}
              />
              {toggle.label}
            </label>
          ))}
        </div>

        {reference && (
          <div className="rounded-md border border-border/60 p-2.5">
            <SectionLabel>Manasik answer · internal reference</SectionLabel>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{reference}</p>
          </div>
        )}

        {error && <p className={cn("text-sm", TONE_TEXT.danger)}>{error}</p>}

        <div className="flex flex-col gap-1.5">
          {generating && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Manasik Copilot is drafting a reply…
            </p>
          )}
          <Textarea
            ref={textarea}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-56 text-sm"
            aria-label="Reply draft"
            disabled={generating}
          />
          <SourceNote source={source} />
          {warnings.length > 0 && (
            <div className={cn("rounded-md p-2 text-xs", TONE_STAT_CARD.warning)}>
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={regenerate} disabled={generating}>
            {generating && <Loader2 className="animate-spin" />}
            Regenerate
          </Button>
          <Button variant="outline" onClick={() => textarea.current?.focus()} disabled={generating}>
            Edit
          </Button>
          <Button variant="outline" onClick={copy} disabled={!text || generating}>
            <Copy /> Copy
          </Button>
          <Button onClick={save} disabled={!text.trim() || generating || saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
