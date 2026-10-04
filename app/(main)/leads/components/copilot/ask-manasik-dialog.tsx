"use client";

/**
 * Ask Manasik about this Lead — a one-question-at-a-time command dialog,
 * scoped to one lead's data. No conversation history is kept.
 */

import { Loader2 } from "lucide-react";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SUGGESTED_QUESTIONS } from "@/lib/copilot/sales/ask-manasik";
import type { AskFollowUp, CopilotAnswer, ReplyLanguage } from "@/lib/copilot/sales/types";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

import { askManasikAction } from "../../copilot-actions";
import { useLeads } from "../../leads-store";
import type { LeadListItem } from "../../types";
import { BulletList, SourceNote } from "./offer-parts";

interface AskManasikDialogProps {
  lead: LeadListItem;
  onClose: () => void;
  onUseInReply: (answer: string) => void;
  onBuildOffer: () => void;
  onCreateQuote: (offerId: string) => void;
  onDraftReply: (language: ReplyLanguage) => void;
}

export default function AskManasikDialog({
  lead,
  onClose,
  onUseInReply,
  onBuildOffer,
  onCreateQuote,
  onDraftReply,
}: AskManasikDialogProps) {
  const { can } = useLeads();
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<CopilotAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    setPending(true);
    setError(null);
    const result = await askManasikAction({ leadId: lead.id, question: trimmed });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAnswer(result);
  };

  const allowed = (followUp: AskFollowUp): boolean => {
    if (followUp.action === "CREATE_QUOTE") return can.createQuoteDraft;
    if (followUp.action === "USE_IN_REPLY" || followUp.action === "DRAFT_REPLY") return can.draftCustomerReply;
    return true;
  };

  const run = (followUp: AskFollowUp) => {
    if (!answer) return;
    switch (followUp.action) {
      case "USE_IN_REPLY":
        onUseInReply(answer.answer);
        break;
      case "BUILD_OFFER":
        onBuildOffer();
        break;
      case "CREATE_QUOTE":
        onCreateQuote(followUp.offerId);
        break;
      case "DRAFT_REPLY":
        onDraftReply(followUp.language);
        break;
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ask Manasik about this Lead</DialogTitle>
          <DialogDescription>
            {lead.name} · {lead.reference} · answers use only this lead’s data and live package/group records
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS.map((suggestion) => (
            <Button key={suggestion} size="xs" variant="outline" onClick={() => ask(suggestion)} disabled={pending}>
              {suggestion}
            </Button>
          ))}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask a question..."
            aria-label="Question"
            maxLength={500}
          />
          <Button type="submit" disabled={pending || !question.trim()}>
            {pending && <Loader2 className="animate-spin" />}
            Ask
          </Button>
        </form>

        {error && <p className={cn("text-sm", TONE_TEXT.danger)}>{error}</p>}

        {pending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Manasik Copilot is reading this lead…
          </p>
        )}

        {answer && !pending && (
          <div className="flex flex-col gap-3 rounded-md border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">{answer.question}</p>
            <p className="text-sm text-foreground whitespace-pre-wrap">{answer.answer}</p>
            <BulletList title="Based on" items={answer.sources} />
            <SourceNote source={answer.source} />
            {answer.followUps.filter(allowed).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {answer.followUps.filter(allowed).map((followUp) => (
                  <Button key={followUp.label} size="sm" variant="outline" onClick={() => run(followUp)}>
                    {followUp.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
