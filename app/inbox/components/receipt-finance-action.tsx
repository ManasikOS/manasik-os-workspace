"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  financeEvidenceItemHref,
  settleReceiptFinancePromotion,
  type ReceiptFinancePromotionAvailability,
} from "@/lib/finance/finance-evidence";

import { copyReceiptToFinanceAction } from "../actions";

export function ReceiptFinanceAction({
  attachmentId,
  availability,
}: {
  attachmentId: string;
  availability: ReceiptFinancePromotionAvailability;
}) {
  const [pending, startTransition] = useTransition();
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "SUCCESS" | "ERROR";
    message: string;
  } | null>(null);

  if (availability.state === "HIDDEN") return null;

  if (availability.state === "DENIED") {
    return (
      <p className="px-1 text-xs text-muted-foreground" role="note">
        {availability.reason}
      </p>
    );
  }

  return (
    <Card className="gap-3 p-4 shadow-sm" aria-label="Finance evidence copy">
      <div className="space-y-1">
        <p className="text-sm font-medium">Finance evidence</p>
        <p className="text-xs text-muted-foreground">
          Copy this receipt for Finance to review. This does not create or
          verify a payment.
        </p>
      </div>

      {evidenceId ? (
        <Button
          size="sm"
          variant="outline_without_border"
          nativeButton={false}
          render={<a href={financeEvidenceItemHref(evidenceId)} />}
        >
          Open Finance evidence
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setFeedback(null);
              const promotion = await copyReceiptToFinanceAction({
                attachmentId,
              });
              const settlement = settleReceiptFinancePromotion(promotion);
              if (settlement.state === "COPIED") {
                setEvidenceId(settlement.evidenceId);
                setFeedback({
                  kind: "SUCCESS",
                  message: settlement.message,
                });
                return;
              }
              setFeedback({ kind: "ERROR", message: settlement.message });
            })
          }
        >
          {pending ? "Copying to Finance…" : "Copy to Finance"}
        </Button>
      )}

      {feedback && (
        <p
          className={
            feedback.kind === "ERROR"
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
          role={feedback.kind === "ERROR" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      )}
    </Card>
  );
}
