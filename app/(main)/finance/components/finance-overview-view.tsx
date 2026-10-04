"use client";

import { useState, useTransition } from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/tone-badge";

import { generateCashRiskBriefingAction, type CashRiskBriefingActionResult } from "../actions";

/** Staff-triggered assistance below the deterministic Finance queue. */
export default function FinanceCashRiskBriefing() {
  const [briefing, setBriefing] = useState<CashRiskBriefingActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const runBriefing = () => {
    startTransition(async () => {
      const result = await generateCashRiskBriefingAction();
      setBriefing(result);
    });
  };

  return (
      <Card className="gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h2 className="text-sm font-medium text-foreground">Manasik Copilot — Cash Risk Briefing</h2>
          </div>
          <Button variant="outline_without_border" size="sm" onClick={runBriefing} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {briefing ? "Refresh" : "Generate briefing"}
          </Button>
        </div>

        {!briefing && !pending && (
          <EmptyState
            title="No briefing generated yet"
            description="Manasik Copilot reads only the tiles above — it never invents a number, and every figure it states is checked against this data before it's shown."
          />
        )}

        {briefing && !briefing.ok && (
          <EmptyState title="Briefing unavailable" description={briefing.error ?? "Unknown error."} />
        )}

        {briefing?.ok && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-foreground">{briefing.summary}</p>
            {briefing.risks && briefing.risks.length > 0 && (
              <ul className="flex flex-col gap-1.5 list-disc pl-5">
                {briefing.risks.map((risk, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    {risk}
                  </li>
                ))}
              </ul>
            )}
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Source: {briefing.source === "LLM" ? "Manasik Copilot" : "Not generated (rules fallback)"}
            </span>
          </div>
        )}
      </Card>
  );
}
