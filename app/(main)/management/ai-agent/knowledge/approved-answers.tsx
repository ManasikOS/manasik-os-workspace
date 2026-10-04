"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { reviewInboxApprovedAnswerAction } from "./approved-answer-actions";

export interface ApprovedAnswerCandidate { id: string; normalized_question: string; answer_text: string; occurrence_count: number }

export function ApprovedInboxAnswers({ candidates, canApprove }: { candidates: ApprovedAnswerCandidate[]; canApprove: boolean }) {
  const [pending, startTransition] = useTransition();
  const review = (answerId: string, decision: "APPROVE" | "REJECT") => startTransition(async () => {
    const result = await reviewInboxApprovedAnswerAction({ answerId, decision, ...(decision === "REJECT" ? { reason: "Rejected by an authorised reviewer." } : {}) });
    toast.add({ title: result.ok ? (decision === "APPROVE" ? "Answer approved" : "Answer retired") : "Could not review answer", ...(!result.ok ? { description: result.error } : {}) });
  });
  if (candidates.length === 0) return null;
  return <section className="space-y-3"><div><h2 className="text-base font-semibold">Repeated answer candidates</h2><p className="text-sm text-muted-foreground">Only approved, grounded answers can be reused. Prices, availability and sensitive advice are never eligible.</p></div>{candidates.map((candidate) => <article key={candidate.id} className="rounded-lg border p-4"><p className="text-sm font-medium">{candidate.normalized_question}</p><p className="mt-2 text-sm text-muted-foreground">{candidate.answer_text}</p><p className="mt-2 text-xs">Seen consistently {candidate.occurrence_count} times</p>{canApprove && <div className="mt-3 flex gap-2"><Button size="sm" disabled={pending} onClick={() => review(candidate.id, "APPROVE")}>Approve</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => review(candidate.id, "REJECT")}>Reject</Button></div>}</article>)}</section>;
}
