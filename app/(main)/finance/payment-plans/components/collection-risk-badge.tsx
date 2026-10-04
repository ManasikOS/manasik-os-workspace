"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToneBadge } from "@/components/ui/tone-badge";
import type { Tone } from "@/lib/ui/tone";

import type { CollectionRiskBand } from "@/lib/finance/collection-risk";
import { explainCollectionRiskAction } from "../actions";

const BAND_TONE: Record<CollectionRiskBand, Tone> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
};

const BAND_LABEL: Record<CollectionRiskBand, string> = {
  LOW: "Low risk",
  MEDIUM: "Medium risk",
  HIGH: "High risk",
  CRITICAL: "Critical risk",
};

interface CollectionRiskBadgeProps {
  bookingId: string;
  band: CollectionRiskBand;
  score: number;
}

/**
 * The score/band shown here is always the deterministic
 * `computeCollectionRisk()` output — the popover's "Explain" button is the
 * only thing that calls Manasik Copilot, and only to narrate a score already
 * fixed, never to produce one of its own (plan §4.14).
 */
export default function CollectionRiskBadge({ bookingId, band, score }: CollectionRiskBadgeProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; explanation?: string; suggestedAction?: string; error?: string } | null>(null);

  if (band === "LOW") return <ToneBadge tone={BAND_TONE[band]} label={BAND_LABEL[band]} />;

  const explain = () => {
    if (result || pending) return;
    startTransition(async () => {
      const r = await explainCollectionRiskAction(bookingId);
      setResult(r);
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) explain();
      }}
    >
      <PopoverTrigger>
        <ToneBadge tone={BAND_TONE[band]} label={`${BAND_LABEL[band]} (${score})`} />
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-primary" /> Manasik Copilot
          </PopoverTitle>
        </PopoverHeader>
        {pending && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Reading this booking&apos;s payment history…
          </p>
        )}
        {!pending && result && !result.ok && (
          <p className="text-xs text-muted-foreground">{result.error ?? "Could not generate an explanation."}</p>
        )}
        {!pending && result?.ok && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-foreground">{result.explanation}</p>
            <p className="text-xs font-medium text-foreground">{result.suggestedAction}</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
