"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import SectionHeading from "@/components/section-heading";

import { identifyBookingBlockers, type BookingBlockerTravellerInput } from "@/lib/bookings/blockers";
import type { BookingInconsistency } from "@/lib/bookings/inconsistencies";
import type { Tone } from "@/lib/ui/tone";

import { analyzeBookingAction } from "./analysis-actions";

const SEVERITY_TONE: Record<"CRITICAL" | "WARNING", Tone> = { CRITICAL: "danger", WARNING: "warning" };

export interface BookingAiAnalysisTabProps {
  bookingId: string;
  outstandingBalance: number;
  nextDueAt: string | null;
  primaryContactName: string;
  primaryContactPhone: string;
  departureDate: string | null;
  travellers: BookingBlockerTravellerInput[];
}

/**
 * "identifyBlockers" + "detectInconsistencies" (plan §4.5). Blockers are
 * computed here, client-side, from props the page already loaded — pure
 * and free. The "Ask Manasik Copilot" button is the only thing that calls
 * the server: it fetches the two things blockers can't see (the
 * originating quote's traveller count, invoiced total) and asks the model
 * to sequence and explain what was found — never to invent a new finding.
 */
export default function BookingAiAnalysisTab({
  bookingId,
  outstandingBalance,
  nextDueAt,
  primaryContactName,
  primaryContactPhone,
  departureDate,
  travellers,
}: BookingAiAnalysisTabProps) {
  const [pending, startTransition] = useTransition();
  const [inconsistencies, setInconsistencies] = useState<BookingInconsistency[] | null>(null);
  const [narration, setNarration] = useState<{ resolutionSequence: string; inconsistencyNotes: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blockers = useMemo(
    () =>
      identifyBookingBlockers(
        { outstandingBalance, nextDueAt, primaryContactName, primaryContactPhone, departureDate, travellers },
        new Date().toISOString(),
      ),
    [outstandingBalance, nextDueAt, primaryContactName, primaryContactPhone, departureDate, travellers],
  );

  const analyze = () => {
    setError(null);
    startTransition(async () => {
      const result = await analyzeBookingAction({ bookingId });
      if (!result.ok) {
        setError(result.error ?? "Could not generate an explanation.");
        setInconsistencies(result.inconsistencies ?? null);
        return;
      }
      setInconsistencies(result.inconsistencies ?? []);
      setNarration({ resolutionSequence: result.resolutionSequence ?? "", inconsistencyNotes: result.inconsistencyNotes ?? "" });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <SectionHeading title="Blockers" description="Computed deterministically from this booking's own data — never from a model guess." />
        {blockers.length === 0 ? (
          <EmptyState title="No blockers found" description="Nothing here needs attention right now." />
        ) : (
          <Card className="p-0 divide-y divide-border/20 mt-3">
            {blockers.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3">
                <ToneBadge tone={SEVERITY_TONE[b.severity]} label={b.severity} />
                <p className="text-sm text-foreground">{b.message}</p>
              </div>
            ))}
          </Card>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <Button size="sm" variant="outline_without_border" onClick={analyze} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Ask Manasik Copilot to sequence &amp; check for inconsistencies
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {narration && (
        <Card className="flex flex-col gap-2 p-4">
          <p className="text-sm text-foreground">{narration.resolutionSequence}</p>
        </Card>
      )}

      {inconsistencies !== null && (
        <div>
          <SectionHeading title="Inconsistencies" description="Quote, booking and invoice figures cross-checked against each other." />
          {inconsistencies.length === 0 ? (
            <EmptyState title="Nothing inconsistent" description="Quote, booking and invoice totals all agree." />
          ) : (
            <Card className="p-0 divide-y divide-border/20 mt-3">
              {inconsistencies.map((i) => (
                <div key={i.id} className="px-4 py-3">
                  <p className="text-sm text-foreground">{i.message}</p>
                </div>
              ))}
            </Card>
          )}
          {narration && <p className="text-xs text-muted-foreground">{narration.inconsistencyNotes}</p>}
        </div>
      )}
    </div>
  );
}
