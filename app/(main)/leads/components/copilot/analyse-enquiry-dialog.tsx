"use client";

/**
 * Analyse Customer Enquiry — paste a conversation, get an editable
 * TravelIntent, then explicitly choose which lead fields to update.
 * Extraction happens on the server (rules, or OpenRouter when configured).
 */

import { Loader2 } from "lucide-react";
import React, { useEffect, useState } from "react";

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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { MONTH_NAMES, travellersLabel } from "@/lib/copilot/sales/format";
import { describeBudget, describeTravelWindow, type IntentFieldProposal } from "@/lib/copilot/sales/intent-conflicts";
import { tierForBudget } from "@/lib/copilot/sales/intent-extraction";
import type { IntentLeadField } from "@/lib/copilot/sales/schemas";
import type { ReasoningSource, TravelIntent } from "@/lib/copilot/sales/types";
import { TONE_STAT_CARD, TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

import { analyseEnquiryAction, applyTravelIntentAction, proposeIntentChangesAction } from "../../copilot-actions";
import type { LeadListItem } from "../../types";
import {
  BulletList,
  ChoiceSelect,
  DECISION_LABEL,
  DISTANCE_LABEL,
  DetailLine,
  FieldLabel,
  GROUP_TYPE_LABEL,
  JOURNEY_LABEL,
  LEVEL_LABEL,
  SectionLabel,
  SourceNote,
  TIER_LABEL,
  type Choice,
} from "./offer-parts";

interface AnalyseEnquiryDialogProps {
  lead: LeadListItem;
  /** Opens straight into the editor with this intent ("Adjust Preferences"). */
  initialIntent: TravelIntent | null;
  startEditing: boolean;
  onClose: () => void;
  onApplied: () => void;
  onFindBestGroup: (intent: TravelIntent) => void;
}

const ROOM_LABEL = { QUAD: "Quad", TRIPLE: "Triple", DOUBLE: "Double", SINGLE: "Single", NOT_DECIDED: "Not decided" } as const;

export default function AnalyseEnquiryDialog({
  lead,
  initialIntent,
  startEditing,
  onClose,
  onApplied,
  onFindBestGroup,
}: AnalyseEnquiryDialogProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<TravelIntent | null>(initialIntent);
  const [source, setSource] = useState<ReasoningSource>("RULES");
  const [note, setNote] = useState<string | null>(null);
  const [proposals, setProposals] = useState<IntentFieldProposal[]>([]);
  const [selected, setSelected] = useState<IntentLeadField[]>([]);
  const [editing, setEditing] = useState(startEditing && initialIntent !== null);

  // "Adjust Preferences" arrives with an intent but no conflict list yet.
  useEffect(() => {
    if (!initialIntent) return;
    let cancelled = false;
    proposeIntentChangesAction({ leadId: lead.id, intent: initialIntent }).then((next) => {
      if (cancelled) return;
      setProposals(next);
      setSelected(next.filter((proposal) => proposal.applyByDefault).map((proposal) => proposal.field));
    });
    return () => {
      cancelled = true;
    };
  }, [initialIntent, lead.id]);

  const analyse = async () => {
    setPending(true);
    setError(null);
    const result = await analyseEnquiryAction({ leadId: lead.id, text });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setIntent(result.intent);
    setSource(result.source);
    setNote(result.note);
    setProposals(result.proposals);
    setSelected(result.proposals.filter((proposal) => proposal.applyByDefault).map((proposal) => proposal.field));
  };

  const finishEditing = async () => {
    if (!intent) return;
    setEditing(false);
    const next = await proposeIntentChangesAction({ leadId: lead.id, intent });
    setProposals(next);
    setSelected(next.filter((proposal) => proposal.applyByDefault).map((proposal) => proposal.field));
  };

  const apply = async () => {
    if (!intent) return;
    setPending(true);
    const result = await applyTravelIntentAction({ leadId: lead.id, intent, fields: selected });
    setPending(false);
    if (!result.ok) {
      toast.add({ title: "Could not apply", description: result.error });
      return;
    }
    toast.add({
      title: "Travel intent applied",
      description: selected.length > 0 ? `${selected.length} lead field(s) updated.` : "Saved for offer matching.",
    });
    onApplied();
    onClose();
  };

  const toggle = (field: IntentLeadField, on: boolean) =>
    setSelected((current) => (on ? [...new Set([...current, field])] : current.filter((entry) => entry !== field)));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Analyse Customer Enquiry</DialogTitle>
          <DialogDescription>
            {lead.name} · {lead.reference}
          </DialogDescription>
        </DialogHeader>

        {!intent ? (
          <div className="flex flex-col gap-3">
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste the customer’s WhatsApp messages, call notes, or enquiry here…"
              className="min-h-40 text-sm"
              aria-label="Customer enquiry"
            />
            {lead.notes.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {lead.notes.length} existing internal note{lead.notes.length === 1 ? "" : "s"} will be included as read-only context
                </summary>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {lead.notes.slice(0, 5).map((entry) => (
                    <li key={entry.id} className="line-clamp-2">
                      {entry.body}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {pending && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Manasik Copilot is reading the enquiry…
              </p>
            )}
            {error && <p className={cn("text-xs", TONE_TEXT.danger)}>{error}</p>}
          </div>
        ) : editing ? (
          <IntentEditor intent={intent} onChange={setIntent} />
        ) : (
          <div className="flex flex-col gap-4">
            <IntentSummary intent={intent} />
            <SourceNote source={source} note={note} />

            <div className="flex flex-col gap-1.5">
              <SectionLabel>Apply to lead</SectionLabel>
              {proposals.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No lead fields would change. Applying saves this travel intent for offer matching.
                </p>
              ) : (
                proposals.map((proposal) => (
                  <label
                    key={proposal.field}
                    className={cn(
                      "flex items-start gap-2 rounded-md px-2 py-1.5 text-sm",
                      proposal.conflict && TONE_STAT_CARD.warning,
                    )}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selected.includes(proposal.field)}
                      onCheckedChange={(checked) => toggle(proposal.field, checked === true)}
                    />
                    <span className="flex-1">
                      {proposal.label}: <span className="font-medium">{proposal.proposedValue}</span>{" "}
                      <span className="text-muted-foreground">(lead: {proposal.currentValue})</span>
                      {proposal.conflict && (
                        <span className={cn("block text-xs", TONE_TEXT.warning)}>
                          Differs from what staff entered — only applied if ticked.
                        </span>
                      )}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {!intent ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={analyse} disabled={pending || text.trim().length < 10}>
                {pending && <Loader2 className="animate-spin" />}
                Analyse with Manasik
              </Button>
            </>
          ) : editing ? (
            <Button onClick={finishEditing}>Done Editing</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                Edit Details
              </Button>
              <Button variant="outline" onClick={() => onFindBestGroup(intent)}>
                Find Best Group
              </Button>
              <Button onClick={apply} disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                Apply to Lead
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Summary ──────────────────────────────────────────────────────────────── */

function IntentSummary({ intent }: { intent: TravelIntent }) {
  const room = intent.accommodationPreferences.roomType;
  const familyRoom = intent.extractedFacts.some((fact) => /family room/i.test(fact));
  const roomText = room
    ? `${ROOM_LABEL[room]}${familyRoom && room !== "NOT_DECIDED" ? " or family room" : familyRoom ? " (asked about family rooms)" : ""}`
    : "Not mentioned";
  const distance = intent.accommodationPreferences.hotelDistancePreference;
  const tier = intent.accommodationPreferences.hotelTier;
  const hotel = [distance ? DISTANCE_LABEL[distance] : null, tier && tier !== "UNKNOWN" ? `${TIER_LABEL[tier]} tier` : null]
    .filter(Boolean)
    .join(" · ");
  const signals = intent.commercialSignals;
  const commercial = [
    signals.instalmentInterest ? "Interested in instalments" : null,
    `Budget sensitivity: ${LEVEL_LABEL[signals.budgetSensitivity]}`,
    describeBudget(intent),
    signals.urgency !== "UNKNOWN" ? `Urgency: ${LEVEL_LABEL[signals.urgency]}` : null,
    signals.decisionStage !== "UNKNOWN" ? `Stage: ${DECISION_LABEL[signals.decisionStage]}` : null,
  ].filter((line): line is string => Boolean(line));
  const preferences = [
    intent.travelPreferences.flightPreference && intent.travelPreferences.flightPreference !== "UNKNOWN"
      ? `Flight: ${intent.travelPreferences.flightPreference.replace("_", " ").toLowerCase()}`
      : null,
    intent.travelPreferences.mealPreference ? `Meals: ${intent.travelPreferences.mealPreference}` : null,
    intent.travelPreferences.ziyarahInterest ? "Interested in Ziyarah" : null,
    ...(intent.travelPreferences.accessibilityNeeds ?? []),
  ].filter((line): line is string => Boolean(line));
  const travellers = intent.travellers;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <DetailLine label="Journey">{intent.journeyType ? JOURNEY_LABEL[intent.journeyType] : "Not mentioned"}</DetailLine>
        <DetailLine label="Travel window">{describeTravelWindow(intent) ?? "Not mentioned"}</DetailLine>
        <DetailLine label="Travellers">
          {travellers.adults > 0
            ? `${travellersLabel(travellers.adults, travellers.children, travellers.infants)} · ${GROUP_TYPE_LABEL[travellers.groupType]}`
            : "Not mentioned"}
        </DetailLine>
        <DetailLine label="Room preference">{roomText}</DetailLine>
        <DetailLine label="Hotel preference">{hotel || "Not mentioned"}</DetailLine>
      </div>
      <BulletList title="Commercial" items={commercial} />
      <BulletList title="Travel preferences" items={preferences} />
      <BulletList title="Questions / missing information" items={intent.unansweredQuestions} />
      {intent.extractedFacts.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Evidence ({intent.extractedFacts.length}) · confidence {Math.round(intent.confidence * 100)}%
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {intent.extractedFacts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* ── Editor ───────────────────────────────────────────────────────────────── */

type Journey = NonNullable<TravelIntent["journeyType"]> | "NONE";
type Month = (typeof MONTH_NAMES)[number] | "NONE";
type Room = NonNullable<TravelIntent["accommodationPreferences"]["roomType"]>;
type Distance = NonNullable<TravelIntent["accommodationPreferences"]["hotelDistancePreference"]>;

const JOURNEY_CHOICES: Choice<Journey>[] = [
  { value: "NONE", label: "Not mentioned" },
  { value: "UMRAH", label: "Umrah" },
  { value: "HAJJ", label: "Hajj" },
  { value: "EARLY_REGISTRATION", label: "Early Registration" },
];
const MONTH_CHOICES: Choice<Month>[] = [
  { value: "NONE", label: "Not mentioned" },
  ...MONTH_NAMES.map((month) => ({ value: month, label: month })),
];
const FLEX_CHOICES: Choice<TravelIntent["travelWindow"]["flexibility"]>[] = [
  { value: "UNKNOWN", label: "Unknown" },
  { value: "FLEXIBLE", label: "Flexible" },
  { value: "FIXED", label: "Fixed dates" },
];
const ROOM_CHOICES: Choice<Room>[] = (Object.keys(ROOM_LABEL) as Room[]).map((value) => ({ value, label: ROOM_LABEL[value] }));
const DISTANCE_CHOICES: Choice<Distance>[] = (Object.keys(DISTANCE_LABEL) as Distance[]).map((value) => ({
  value,
  label: DISTANCE_LABEL[value],
}));

const pad = (value: number) => String(value).padStart(2, "0");

function withMonth(intent: TravelIntent, month: Month): TravelIntent {
  if (month === "NONE") return { ...intent, travelWindow: { flexibility: intent.travelWindow.flexibility } };
  const index = MONTH_NAMES.indexOf(month);
  const now = new Date();
  const year = index >= now.getMonth() ? now.getFullYear() : now.getFullYear() + 1;
  const last = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  return {
    ...intent,
    travelWindow: {
      ...intent.travelWindow,
      preferredMonth: month,
      earliestDate: `${year}-${pad(index + 1)}-01`,
      latestDate: `${year}-${pad(index + 1)}-${pad(last)}`,
    },
  };
}

function count(value: string, min: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), 60) : min;
}

function IntentEditor({ intent, onChange }: { intent: TravelIntent; onChange: (intent: TravelIntent) => void }) {
  const month = (MONTH_NAMES as readonly string[]).includes(intent.travelWindow.preferredMonth ?? "")
    ? (intent.travelWindow.preferredMonth as Month)
    : "NONE";
  const set = (patch: Partial<TravelIntent>) => onChange({ ...intent, ...patch });

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="intent-journey">Journey</FieldLabel>
        <ChoiceSelect
          id="intent-journey"
          value={intent.journeyType ?? "NONE"}
          choices={JOURNEY_CHOICES}
          onChange={(value) => set({ journeyType: value === "NONE" ? undefined : value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="intent-month">Travel month</FieldLabel>
        <ChoiceSelect id="intent-month" value={month} choices={MONTH_CHOICES} onChange={(value) => onChange(withMonth(intent, value))} />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="intent-flex">Flexibility</FieldLabel>
        <ChoiceSelect
          id="intent-flex"
          value={intent.travelWindow.flexibility}
          choices={FLEX_CHOICES}
          onChange={(value) => set({ travelWindow: { ...intent.travelWindow, flexibility: value } })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="intent-room">Room</FieldLabel>
        <ChoiceSelect
          id="intent-room"
          value={intent.accommodationPreferences.roomType ?? "NOT_DECIDED"}
          choices={ROOM_CHOICES}
          onChange={(value) => set({ accommodationPreferences: { ...intent.accommodationPreferences, roomType: value } })}
        />
      </div>
      {(["adults", "children", "infants"] as const).map((key) => (
        <div key={key} className="flex flex-col gap-1">
          <FieldLabel htmlFor={`intent-${key}`}>{key.charAt(0).toUpperCase() + key.slice(1)}</FieldLabel>
          <Input
            id={`intent-${key}`}
            type="number"
            min={key === "adults" ? 1 : 0}
            value={intent.travellers[key]}
            onChange={(event) =>
              set({ travellers: { ...intent.travellers, [key]: count(event.target.value, key === "adults" ? 1 : 0) } })
            }
          />
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="intent-distance">Hotel distance</FieldLabel>
        <ChoiceSelect
          id="intent-distance"
          value={intent.accommodationPreferences.hotelDistancePreference ?? "UNKNOWN"}
          choices={DISTANCE_CHOICES}
          onChange={(value) =>
            set({ accommodationPreferences: { ...intent.accommodationPreferences, hotelDistancePreference: value } })
          }
        />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="intent-budget">Budget per person (LKR)</FieldLabel>
        <Input
          id="intent-budget"
          type="number"
          min={0}
          value={intent.commercialSignals.statedBudget ?? ""}
          placeholder="Not stated"
          onChange={(event) => {
            const raw = event.target.value.trim();
            const value = raw === "" ? undefined : Math.max(Number(raw), 0);
            set({
              commercialSignals: {
                ...intent.commercialSignals,
                statedBudget: value,
                budgetRange: value === undefined ? intent.commercialSignals.budgetRange : tierForBudget(value, intent.journeyType),
              },
            });
          }}
        />
      </div>
      <div className="col-span-2 flex items-center justify-between gap-3 pt-1">
        <FieldLabel htmlFor="intent-instalments">Interested in instalments</FieldLabel>
        <Switch
          id="intent-instalments"
          checked={intent.commercialSignals.instalmentInterest}
          onCheckedChange={(checked) =>
            set({ commercialSignals: { ...intent.commercialSignals, instalmentInterest: checked } })
          }
        />
      </div>
    </div>
  );
}
