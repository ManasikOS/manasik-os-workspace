"use client";

/**
 * Small presentational pieces shared by the Manasik Decision dialogs.
 * No reasoning lives here — everything shown comes from a Server Action.
 */

import React from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ReasoningSource, SalesStrategy, TravelIntent } from "@/lib/copilot/sales/types";

export interface Choice<T extends string> {
  value: T;
  label: string;
}

export function ChoiceSelect<T extends string>({
  id,
  value,
  choices,
  onChange,
  disabled,
}: {
  id?: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const label = choices.find((choice) => choice.value === value)?.label ?? value;
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next as T);
      }}
    >
      <SelectTrigger id={id} size="sm" className="w-full text-xs">
        <SelectValue>{() => label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value} className="text-xs">
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-foreground">
      {children}
    </label>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>;
}

export function BulletList({ title, items, className }: { title: string; items: readonly string[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <SectionLabel>{title}</SectionLabel>
      <ul className="flex flex-col gap-0.5 text-sm text-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 size-1 rounded-full bg-muted-foreground/60 shrink-0" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DetailLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground text-right min-w-0">{children}</span>
    </div>
  );
}

/** Says plainly where a result came from — rules or a model. */
export function SourceNote({ source, note }: { source: ReasoningSource; note?: string | null }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      {source === "LLM" ? "AI-assisted via OpenRouter · review before using" : "Rule-based — no AI model used"}
      {note ? ` · ${note}` : ""}
    </p>
  );
}

const STAGE_LABEL: Record<SalesStrategy["customerStage"], string> = {
  EXPLORING: "Exploring",
  COMPARING: "Comparing",
  READY_TO_BOOK: "Ready to book",
};

export function StrategyBlock({ strategy }: { strategy: SalesStrategy }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/60 p-3">
      <SectionLabel>Sales strategy · internal</SectionLabel>
      <DetailLine label="Customer stage">{STAGE_LABEL[strategy.customerStage]}</DetailLine>
      <DetailLine label="Sales angle">{strategy.recommendedSalesAngle}</DetailLine>
      {strategy.likelyObjections.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Likely objections</SectionLabel>
          {strategy.likelyObjections.map((objection, index) => (
            <div key={objection} className="text-sm">
              <p className="font-medium text-foreground">{objection}</p>
              <p className="text-muted-foreground">{strategy.objectionHandlingPoints[index]}</p>
            </div>
          ))}
        </div>
      )}
      <DetailLine label="Conversation goal">{strategy.bestNextConversationGoal}</DetailLine>
      <BulletList title="Information still needed" items={strategy.missingInformationToAsk} />
      <DetailLine label="Suggested message">{strategy.suggestedMessageIntent}</DetailLine>
    </div>
  );
}

/* ── Label maps ───────────────────────────────────────────────────────────── */

export const JOURNEY_LABEL: Record<NonNullable<TravelIntent["journeyType"]>, string> = {
  UMRAH: "Umrah",
  HAJJ: "Hajj",
  EARLY_REGISTRATION: "Early Registration",
};

export const GROUP_TYPE_LABEL: Record<TravelIntent["travellers"]["groupType"], string> = {
  SOLO: "Solo",
  COUPLE: "Couple",
  FAMILY: "Family",
  GROUP: "Group",
  UNKNOWN: "Not stated",
};

export const DISTANCE_LABEL: Record<NonNullable<TravelIntent["accommodationPreferences"]["hotelDistancePreference"]>, string> = {
  VERY_CLOSE: "Close to Haram",
  WALKABLE: "Walking distance",
  FLEXIBLE: "Flexible",
  UNKNOWN: "Not mentioned",
};

export const LEVEL_LABEL: Record<"HIGH" | "MEDIUM" | "LOW" | "UNKNOWN", string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNKNOWN: "Unknown",
};

export const TIER_LABEL: Record<"ECONOMY" | "STANDARD" | "PREMIUM" | "VIP" | "UNKNOWN", string> = {
  ECONOMY: "Economy",
  STANDARD: "Standard",
  PREMIUM: "Premium",
  VIP: "VIP",
  UNKNOWN: "Unknown",
};

export const DECISION_LABEL: Record<TravelIntent["commercialSignals"]["decisionStage"], string> = {
  EXPLORING: "Exploring",
  COMPARING: "Comparing",
  READY_TO_BOOK: "Ready to book",
  UNKNOWN: "Unknown",
};

// Moved to lib/quotes/status.ts (Phase 1, P1.4) — the single source every
// quote-status badge in the app reads from, so DRAFT/PENDING_APPROVAL/etc.
// display consistently on the list, detail, and lead-drawer views.
export { QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE } from "@/lib/quotes/status";
