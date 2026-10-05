"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import {
  savePassportToDocumentsAction,
  selectPassportMediaTravellerAction,
} from "../actions";
import { useInboxRefresh } from "./inbox-refresh-context";
import { PassportFieldsReviewForm } from "./passport-fields-review-form";
import { PassportVisaOfficerControl } from "./passport-visa-officer-control";
import { announceComposerDraft } from "./composer-draft-event";
import { paymentAcknowledgementDraft } from "@/lib/inbox/payment-acknowledgement";
import { Card } from "@/components/ui/card";
import SectionHeading from "@/components/section-heading";

export interface AttachmentIntelligenceField {
  label: string;
  value: string;
  confidence: number;
}

/** The staff review of what the AI read from a passport or payment proof. The file itself shows in the chat bubble. */
export function AttachmentIntelligenceCard({
  title,
  kind,
  fields,
  expiresAt,
  attachmentId,
  travellerOptions = [],
  selectedTravellerId = null,
  travellerSelectionRequired = false,
  promotedDocumentId = null,
  canSaveToDocuments = false,
  canOpenFinanceReview = false,
  canAssignVisaOfficer = false,
  canReviewPassportFields = false,
  candidateFields = {},
  conversationId = null,
}: {
  canReviewPassportFields?: boolean;
  candidateFields?: Record<string, unknown>;
  canAssignVisaOfficer?: boolean;
  canOpenFinanceReview?: boolean;
  conversationId?: string | null;
  canSaveToDocuments?: boolean;
  promotedDocumentId?: string | null;
  title: string;
  kind: string;
  fields: AttachmentIntelligenceField[];
  expiresAt: string | null;
  attachmentId: string;
  travellerOptions?: Array<{ id: string; name: string }>;
  selectedTravellerId?: string | null;
  travellerSelectionRequired?: boolean;
}) {
  const refreshInbox = useInboxRefresh();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  return (
    <Card className=" shadow-sm p-4">
      <div>
        <SectionHeading
          title={title}
          description={`${kind} · AI candidate fields require staff review`}
        />
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {fields.map((field) => (
          <Card
            key={field.label}
            className={
              field.confidence < 0.9
                ? "bg-transparent! shadow-xs gap-1 border-destructive/40 p-2"
                : "bg-transparent! shadow-xs gap-1 p-2"
            }
          >
            <InputGroupText className="text-muted-foreground text-xs">
              {field.label.charAt(0).toUpperCase() +
                field.label.slice(1, field.label.length)}
            </InputGroupText>
            <dd className="text-sm">{field.value}</dd>
            <dd className="text-xs">
              LLM · {Math.round(field.confidence * 100)}% confidence
              {field.confidence < 0.9 ? " · Check this field" : ""}
            </dd>
          </Card>
        ))}
      </dl>
      {travellerSelectionRequired && travellerOptions.length > 1 && canReviewPassportFields && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium">
            Choose the traveller before using this passport review.
          </p>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>Traveller</InputGroupText>
            </InputGroupAddon>
            <Select
              value={selectedTravellerId ?? undefined}
              disabled={pending}
              onValueChange={(travellerId) =>
                startTransition(async () => {
                  const result = await selectPassportMediaTravellerAction({
                    attachmentId,
                    travellerId,
                  });
                  setStatus(
                    result.ok
                      ? "Traveller selected. Passport comparison updated."
                      : (result.error ?? "Could not select the traveller."),
                  );
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose traveller" />
              </SelectTrigger>
              <SelectContent>
                {travellerOptions.map((traveller) => (
                  <SelectItem key={traveller.id} value={traveller.id}>
                    {traveller.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InputGroup>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {kind.startsWith("RECEIPT") && (
          <p className="mt-3 flex items-center gap-2 text-xs" role="note">
            <Badge variant="outline">Not verified</Badge>
            <span className="text-muted-foreground">
              A payment counts only after Finance has checked it against the
              booking.
            </span>
          </p>
        )}
        {kind.startsWith("RECEIPT") && (
          <div className="mt-3 flex flex-wrap gap-2">
            {conversationId && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  announceComposerDraft({
                    conversationId,
                    text: paymentAcknowledgementDraft(),
                  });
                  setStatus(
                    "Acknowledgement added to the message box. Read it and edit it before you send.",
                  );
                }}
              >
                Send acknowledgement
              </Button>
            )}
            {canOpenFinanceReview && (
              <Button
                variant="outline_without_border"
                nativeButton={false}
                render={
                  <a
                    href="/finance?view=receivables&subview=payments"
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                Open Finance review
              </Button>
            )}
          </div>
        )}
        {kind.startsWith("PASSPORT") && (
          <p className="mt-3 flex items-center gap-2 text-xs" role="note">
            <Badge variant={promotedDocumentId ? "secondary" : "outline"}>
              {promotedDocumentId
                ? "Saved to Documents"
                : "Not saved to Documents"}
            </Badge>
            <span className="text-muted-foreground">
              {promotedDocumentId
                ? "This copy is kept with the booking documents."
                : "The Inbox copy is temporary and expires."}
            </span>
          </p>
        )}
        {kind.startsWith("PASSPORT") && canReviewPassportFields && (
          <PassportFieldsReviewForm
            attachmentId={attachmentId}
            candidateFields={candidateFields}
            disabledReason={
              travellerSelectionRequired && !selectedTravellerId
                ? "Choose the traveller above to review their passport fields."
                : null
            }
          />
        )}
        {kind.startsWith("PASSPORT") && canAssignVisaOfficer && (
          <PassportVisaOfficerControl
            attachmentId={attachmentId}
            disabledReason={
              travellerSelectionRequired && !selectedTravellerId
                ? "Choose the traveller above to assign their visa file."
                : null
            }
          />
        )}
        {kind.startsWith("PASSPORT") &&
          !promotedDocumentId &&
          canSaveToDocuments && (
            <div className="mt-3 space-y-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={
                  pending ||
                  (travellerSelectionRequired && !selectedTravellerId)
                }
                onClick={() =>
                  startTransition(async () => {
                    const result = await savePassportToDocumentsAction({
                      attachmentId,
                    });
                    setStatus(
                      result.ok
                        ? "Saved to Documents. It now needs verification there."
                        : result.error,
                    );
                    if (result.ok) refreshInbox();
                  })
                }
              >
                {pending ? "Saving…" : "Save to Documents"}
              </Button>
              {travellerSelectionRequired && !selectedTravellerId && (
                <p className="text-xs text-muted-foreground">
                  Choose the traveller above to save this passport.
                </p>
              )}
            </div>
          )}
      </div>
      {expiresAt && !promotedDocumentId && (
        <p className="mt-3 text-xs text-muted-foreground">
          The Inbox copy expires{" "}
          {new Date(expiresAt).toLocaleDateString("en-GB")}.
        </p>
      )}
      {status && (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          {status}
        </p>
      )}
    </Card>
  );
}
