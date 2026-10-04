"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTENT_CODES, type IntentCode } from "@/lib/inbox/intelligence/contracts";
import { reviewConversationTriageAction } from "../actions";

const label = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());

export function TriageReviewControl({ conversationId, predictedIntent, predictionComputedAt }: { conversationId: string; predictedIntent: IntentCode; predictionComputedAt: string }) {
  const [reviewedIntent, setReviewedIntent] = useState<IntentCode>(predictedIntent);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs font-medium">Review this triage reading</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Your review becomes measured promotion evidence; it does not change the conversation.</p>
      <div className="mt-2 flex items-center gap-2">
        <Select items={INTENT_CODES.map((intent) => ({ value: intent, label: label(intent) }))} value={reviewedIntent} onValueChange={(value) => value && setReviewedIntent(value as IntentCode)} disabled={pending}>
          <SelectTrigger aria-label="Reviewed customer intent"><SelectValue /></SelectTrigger>
          <SelectContent>{INTENT_CODES.map((intent) => <SelectItem key={intent} value={intent}>{label(intent)}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" disabled={pending} onClick={() => startTransition(async () => {
          const result = await reviewConversationTriageAction({ conversationId, predictedIntent, reviewedIntent, predictionComputedAt });
          setStatus(result.ok ? "Review recorded" : result.error);
        })}>Record</Button>
      </div>
      {status && <p className="mt-1 text-xs text-muted-foreground" role="status">{status}</p>}
    </div>
  );
}
