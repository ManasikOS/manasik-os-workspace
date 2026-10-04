import type { InboxCapabilities } from "@/lib/access/inbox-access";
import { receiptFinancePromotionAvailability } from "@/lib/finance/finance-evidence";

import type { InboxMediaAnalysis } from "../types";
import { AttachmentIntelligenceCard } from "./attachment-intelligence-card";
import { MediaRoutingActions } from "./media-routing-actions";
import { ReceiptFinanceAction } from "./receipt-finance-action";

/** A passport or payment proof gets a staff review card. Photos, voice notes and other files stay in their chat bubble. */
export function isReviewableMediaAnalysis(analysis: InboxMediaAnalysis): boolean {
  return analysis.kind === "PASSPORT" || analysis.kind === "RECEIPT";
}

/** A brochure or document gets explicit places to keep it, never an automatic send. Photos stay in their bubble. */
export function isRoutableMediaAnalysis(analysis: InboxMediaAnalysis): boolean {
  return (
    analysis.kind === "BROCHURE" ||
    (analysis.kind === "OTHER" && !(analysis.mime_type ?? "").toLowerCase().startsWith("image/"))
  );
}

/**
 * The staff review and routing cards for the files on one message. They render directly under the message that carried
 * the file, so staff never have to work out which photo a card is about.
 */
export function MessageMediaReviews({
  analyses,
  conversationId,
  capabilities,
}: {
  analyses: InboxMediaAnalysis[];
  conversationId: string;
  capabilities: InboxCapabilities;
}) {
  return (
    <>
      {analyses.filter(isReviewableMediaAnalysis).map((analysis) => (
        <div key={analysis.id} className="w-full max-w-md space-y-2">
          <AttachmentIntelligenceCard
            title="Attachment review"
            kind={`${analysis.kind} · ${analysis.status}`}
            fields={Object.entries(analysis.candidate_fields).map(([label, value]) => ({
              label,
              value: String(value ?? "Not read"),
              confidence: analysis.confidence ?? 0,
            }))}
            expiresAt={analysis.expires_at}
            promotedDocumentId={analysis.promoted_document_id}
            canSaveToDocuments={capabilities.saveAttachmentToDocuments}
            canAssignVisaOfficer={capabilities.assignVisaOfficer}
            canReviewPassportFields={capabilities.reviewPassportFields}
            candidateFields={analysis.candidate_fields}
            conversationId={conversationId}
            attachmentId={analysis.attachment_id}
            travellerOptions={analysis.traveller_options}
            selectedTravellerId={analysis.selected_traveller_id}
            travellerSelectionRequired={analysis.review_fields.travellerSelectionRequired === true}
          />
          <ReceiptFinanceAction
            attachmentId={analysis.attachment_id}
            availability={receiptFinancePromotionAvailability({
              kind: analysis.kind,
              status: analysis.status,
              mimeType: analysis.mime_type ?? null,
              canOpenFinanceReview: capabilities.openFinanceReview,
            })}
          />
        </div>
      ))}
      {analyses.filter(isRoutableMediaAnalysis).map((analysis) => (
        <MediaRoutingActions
          key={analysis.id}
          attachmentId={analysis.attachment_id}
          kind={analysis.kind === "BROCHURE" ? "BROCHURE" : "OTHER"}
          mimeType={analysis.mime_type ?? "application/octet-stream"}
          originalHref={analysis.original_href}
          savedDocumentId={analysis.promoted_document_id}
          canSaveToVault={capabilities.saveMediaToVault}
        />
      ))}
    </>
  );
}
