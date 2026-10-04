"use client";

/**
 * Quote Builder — prices a quote draft from the selected offer's live group.
 * The preview is calculated in the browser with the same pure calculator the
 * server uses; on save the server re-reads the price and recalculates, so a
 * stale or tampered figure can never be stored.
 *
 * Saving creates a quote draft only: no booking, no seat hold, no stage change.
 */

import { Copy, Loader2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { ToneBadge } from "@/components/ui/tone-badge";
import { OCCUPANCY_LABELS, formatDateRange, formatLongDate, travellersLabel } from "@/lib/copilot/sales/format";
import { formatMoney } from "@/lib/copilot/sales/money";
import { calculateQuote, type QuoteCalculation } from "@/lib/copilot/sales/quote-calculator";
import type { OccupancyType, QuoteStatus } from "@/lib/copilot/sales/types";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

import { prepareQuoteAction, saveQuoteDraftAction, type QuoteBuilderSeed } from "../../copilot-actions";
import { useLeads } from "../../leads-store";
import type { LeadListItem } from "../../types";
import {
  BulletList,
  ChoiceSelect,
  DetailLine,
  FieldLabel,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
  SectionLabel,
  StrategyBlock,
  type Choice,
} from "./offer-parts";

interface QuoteBuilderSheetProps {
  lead: LeadListItem;
  offerId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function QuoteBuilderSheet({ lead, offerId, onClose, onSaved }: QuoteBuilderSheetProps) {
  const [seed, setSeed] = useState<QuoteBuilderSeed | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    prepareQuoteAction({ leadId: lead.id, offerId }).then((result) => {
      if (cancelled) return;
      if (result.ok) setSeed(result.seed);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [lead.id, offerId]);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="data-[side=right]:sm:max-w-lg w-full">
        <SheetHeader className="gap-1">
          <SheetTitle>Quote Builder</SheetTitle>
          <p className="text-sm text-muted-foreground">
            {lead.name} · {lead.reference}
          </p>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6 overflow-y-auto custom-scroll">
          {!seed && !error && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading live group pricing…
            </p>
          )}
          {error && <p className={cn("text-sm", TONE_TEXT.danger)}>{error}</p>}
          {seed && <QuoteForm seed={seed} onSaved={onSaved} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const EXPIRY_CHOICES: Choice<"3" | "7" | "14" | "30">[] = [
  { value: "3", label: "3 days" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
];

function clampCount(value: string, min: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), 60) : min;
}

function QuoteForm({ seed, onSaved }: { seed: QuoteBuilderSeed; onSaved: () => void }) {
  const { can, nowIso } = useLeads();
  const readOnly = !can.createQuoteDraft;
  const rooms = (Object.keys(seed.occupancyPrices) as OccupancyType[]).filter(
    (room) => seed.occupancyPrices[room] !== undefined,
  );

  const [occupancy, setOccupancy] = useState<OccupancyType>(
    rooms.includes(seed.defaultOccupancy) ? seed.defaultOccupancy : (rooms[0] ?? seed.defaultOccupancy),
  );
  const [adults, setAdults] = useState(seed.adults);
  const [children, setChildren] = useState(seed.children);
  const [infants, setInfants] = useState(seed.infants);
  const [discount, setDiscount] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [expiry, setExpiry] = useState<"3" | "7" | "14" | "30">("7");
  const [inclusions, setInclusions] = useState<string[]>(seed.inclusions);
  const [exclusions, setExclusions] = useState<string[]>(seed.exclusions);
  const [showPreview, setShowPreview] = useState(false);
  const [showStrategy, setShowStrategy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ reference: string; status: QuoteStatus } | null>(null);

  const unitPrice = seed.occupancyPrices[occupancy] ?? 0;
  const calculation = useMemo(
    () =>
      calculateQuote({
        occupancyType: occupancy,
        adults,
        children,
        infants,
        adultPricePerPerson: unitPrice,
        childPrice: seed.childPrice,
        infantPrice: seed.infantPrice,
        depositPerPerson: seed.depositPerPerson,
        discountAmount: discount,
        schedule: seed.paymentSchedule,
        departureDate: seed.departureDate,
        nowIso,
      }),
    [occupancy, adults, children, infants, unitPrice, discount, seed, nowIso],
  );

  const travellers = adults + children + infants;
  const overCapacity = travellers > seed.availableSeats;
  const needsApproval = discount > 0 && !seed.canDiscountFreely;
  const expiresAt = new Date(Date.parse(nowIso) + Number(expiry) * 86_400_000).toISOString();
  const money = (value: number) => formatMoney(value, seed.currency);
  const summary = quoteSummary(seed, calculation, { occupancy, adults, children, infants, expiresAt, status: saved?.status ?? (needsApproval ? "PENDING_APPROVAL" : "DRAFT") });

  const save = async () => {
    setSaving(true);
    const result = await saveQuoteDraftAction({
      leadId: seed.leadId,
      departureGroupId: seed.departureGroupId,
      occupancyType: occupancy,
      adults,
      children,
      infants,
      discountAmount: discount,
      discountReason: discountReason.trim(),
      expiresInDays: Number(expiry),
      inclusions,
      exclusions,
    });
    setSaving(false);
    if (!result.ok) {
      toast.add({ title: "Could not save quote", description: result.error });
      return;
    }
    setSaved({ reference: result.reference, status: result.quote.status });
    toast.add({
      title: `Quote draft ${result.reference} saved`,
      description: result.quote.status === "PENDING_APPROVAL" ? "Discount awaits Admin approval." : "No booking or seat hold was created.",
    });
    onSaved();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      toast.add({ title: "Quote summary copied" });
    } catch {
      toast.add({ title: "Could not copy", description: "Your browser blocked clipboard access." });
    }
  };

  const toggleLine = (list: string[], setList: (next: string[]) => void, line: string, on: boolean) =>
    setList(on ? [...list, line] : list.filter((entry) => entry !== line));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <DetailLine label="Departure group">
          {seed.groupName}
          <span className="block text-xs text-muted-foreground">{formatDateRange(seed.departureDate, seed.returnDate)}</span>
        </DetailLine>
        <DetailLine label="Package">{seed.packageName}</DetailLine>
        <DetailLine label="Seats available">{seed.availableSeats}</DetailLine>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex flex-col gap-1">
          <FieldLabel htmlFor="quote-room">Room type</FieldLabel>
          <ChoiceSelect
            id="quote-room"
            value={occupancy}
            disabled={readOnly || saved !== null}
            choices={rooms.map((room) => ({
              value: room,
              label: `${OCCUPANCY_LABELS[room]} · ${money(seed.occupancyPrices[room] ?? 0)} pp`,
            }))}
            onChange={setOccupancy}
          />
        </div>
        {(
          [
            ["Adults", adults, setAdults, 1],
            ["Children", children, setChildren, 0],
            ["Infants", infants, setInfants, 0],
          ] as const
        ).map(([label, value, setter, min]) => (
          <div key={label} className="flex flex-col gap-1">
            <FieldLabel htmlFor={`quote-${label}`}>{label}</FieldLabel>
            <Input
              id={`quote-${label}`}
              type="number"
              min={min}
              value={value}
              disabled={readOnly || saved !== null}
              onChange={(event) => setter(clampCount(event.target.value, min))}
            />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="quote-expiry">Quote expiry</FieldLabel>
          <ChoiceSelect id="quote-expiry" value={expiry} choices={EXPIRY_CHOICES} onChange={setExpiry} disabled={readOnly || saved !== null} />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="quote-discount">Discount ({seed.currency})</FieldLabel>
          <Input
            id="quote-discount"
            type="number"
            min={0}
            value={discount || ""}
            placeholder="0"
            disabled={readOnly || saved !== null}
            onChange={(event) => setDiscount(Math.max(Number(event.target.value) || 0, 0))}
          />
        </div>
        {discount > 0 && (
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="quote-discount-reason">Discount reason</FieldLabel>
            <Input
              id="quote-discount-reason"
              value={discountReason}
              maxLength={300}
              disabled={readOnly || saved !== null}
              onChange={(event) => setDiscountReason(event.target.value)}
            />
          </div>
        )}
      </div>
      {needsApproval && (
        <p className={cn("text-xs", TONE_TEXT.warning)}>
          Your role cannot apply discounts directly — this quote will be saved as Pending approval for an Admin.
        </p>
      )}
      {overCapacity && (
        <p className={cn("text-xs", TONE_TEXT.danger)}>
          {travellers} travellers exceed the {seed.availableSeats} seats available on this group.
        </p>
      )}

      <div className="flex flex-col gap-1.5 rounded-md border border-border/60 p-3">
        <SectionLabel>Price</SectionLabel>
        {calculation.lines.map((line) => (
          <DetailLine key={line.label} label={`${line.label} · ${money(line.unitPrice)} × ${line.quantity}`}>
            <span className="font-number">{money(line.amount)}</span>
          </DetailLine>
        ))}
        {calculation.discount > 0 && (
          <DetailLine label="Discount">
            <span className="font-number">− {money(calculation.discount)}</span>
          </DetailLine>
        )}
        <DetailLine label="Total">
          <span className="font-semibold font-number">{money(calculation.total)}</span>
        </DetailLine>
        <DetailLine label="Deposit">
          <span className="font-number">{money(calculation.deposit)}</span>
        </DetailLine>
        <DetailLine label="Remaining balance">
          <span className="font-number">{money(calculation.remainingBalance)}</span>
        </DetailLine>
        <BulletList
          title="Payment plan"
          className="pt-1"
          items={calculation.milestones.map((milestone) => `${milestone.label}: ${money(milestone.amount)} · ${milestone.dueLabel}`)}
        />
      </div>

      <LineChecklist
        title="Customer-facing inclusions"
        all={seed.inclusions}
        chosen={inclusions}
        disabled={readOnly || saved !== null}
        onToggle={(line, on) => toggleLine(inclusions, setInclusions, line, on)}
      />
      <LineChecklist
        title="Customer-facing exclusions"
        all={seed.exclusions}
        chosen={exclusions}
        disabled={readOnly || saved !== null}
        onToggle={(line, on) => toggleLine(exclusions, setExclusions, line, on)}
      />

      {saved && (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-foreground">{saved.reference}</span>
          <ToneBadge tone={QUOTE_STATUS_TONE[saved.status]} label={QUOTE_STATUS_LABEL[saved.status]} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!readOnly && !saved && (
          <Button onClick={save} disabled={saving || overCapacity || (discount > 0 && !discountReason.trim())}>
            {saving && <Loader2 className="animate-spin" />}
            Save Quote Draft
          </Button>
        )}
        <Button variant="outline" onClick={() => setShowPreview((value) => !value)}>
          {showPreview ? "Hide Preview" : "Preview"}
        </Button>
        <Button variant="outline" onClick={copy}>
          <Copy /> Copy Summary
        </Button>
        {seed.strategy && (
          <Button variant="ghost" onClick={() => setShowStrategy((value) => !value)}>
            {showStrategy ? "Hide Sales Strategy" : "View Sales Strategy"}
          </Button>
        )}
      </div>

      {showPreview && (
        <pre className="whitespace-pre-wrap rounded-md border border-border/60 p-3 text-sm text-foreground font-sans">{summary}</pre>
      )}
      {showStrategy && seed.strategy && <StrategyBlock strategy={seed.strategy} />}

      <p className="text-[11px] text-muted-foreground">
        A quote draft does not create a booking, reserve seats, or change the lead stage. Move the lead to Proposal
        Sent and create the booking explicitly when the customer agrees.
      </p>
    </div>
  );
}

function LineChecklist({
  title,
  all,
  chosen,
  disabled,
  onToggle,
}: {
  title: string;
  all: string[];
  chosen: string[];
  disabled: boolean;
  onToggle: (line: string, on: boolean) => void;
}) {
  if (all.length === 0) return null;
  return (
    <details className="flex flex-col gap-1">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title} ({chosen.length}/{all.length})
      </summary>
      <div className="mt-1.5 flex flex-col gap-1">
        {all.map((line) => (
          <label key={line} className="flex items-start gap-2 text-sm text-foreground">
            <Checkbox
              className="mt-0.5"
              checked={chosen.includes(line)}
              disabled={disabled}
              onCheckedChange={(checked) => onToggle(line, checked === true)}
            />
            {line}
          </label>
        ))}
      </div>
    </details>
  );
}

function quoteSummary(
  seed: QuoteBuilderSeed,
  calculation: QuoteCalculation,
  form: { occupancy: OccupancyType; adults: number; children: number; infants: number; expiresAt: string; status: QuoteStatus },
): string {
  const money = (value: number) => formatMoney(value, seed.currency);
  const payers = form.adults + form.children;
  const lines = [
    seed.groupName,
    formatDateRange(seed.departureDate, seed.returnDate),
    "",
    `${travellersLabel(form.adults, form.children, form.infants)} · ${OCCUPANCY_LABELS[form.occupancy]}`,
    ...calculation.lines.map((line) => `${line.label}: ${money(line.unitPrice)} × ${line.quantity} = ${money(line.amount)}`),
  ];
  if (calculation.discount > 0) lines.push(`Discount: − ${money(calculation.discount)}`);
  lines.push(`Total: ${money(calculation.total)}`, "", "Deposit:");
  lines.push(
    seed.depositPerPerson !== null
      ? `${money(seed.depositPerPerson)} × ${payers} = ${money(calculation.deposit)}`
      : money(calculation.deposit),
  );
  lines.push("", "Remaining balance:", money(calculation.remainingBalance), "", "Payment plan:");
  for (const milestone of calculation.milestones) {
    lines.push(`- ${milestone.label}: ${money(milestone.amount)} (${milestone.dueLabel.toLowerCase()})`);
  }
  lines.push("", `Valid until: ${formatLongDate(form.expiresAt)}`, `Quote status: ${form.status}`);
  return lines.join("\n");
}
