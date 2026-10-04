/**
 * Where a customer's attachment may be sent next (MED-04). A pure decision table over the media type, the viewer's
 * capabilities and the file's state. It only ever offers explicit, staff-triggered destinations: nothing here sends a
 * file to a customer or publishes collateral. Passports and receipts are deliberately kept out of the shared Document
 * Vault, which every staff role can read; they go only to the traveller's Documents and to Finance intake.
 */

import { financeEvidenceMimeTypeIsSupported } from "@/lib/finance/finance-evidence";

/** Mirrors the `content-vault` bucket's allowed types and 10 MiB limit. */
export const INBOX_MEDIA_VAULT_MAX_BYTES = 10 * 1024 * 1024;
const VAULT_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/** The types the reading model can open; matches the media handler's supported list. */
const READABLE_MIME_TYPES: ReadonlySet<string> = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

export type MediaRoutingKind = "PASSPORT" | "RECEIPT" | "BROCHURE" | "OTHER" | "VOICE";
export type MediaRoutingDestination = "PROPOSAL_COLLATERAL" | "DOCUMENTS" | "FINANCE_INTAKE" | "TRAVELLER_DOCUMENTS" | "DOWNLOAD";

export interface MediaRoutingInput {
  kind: MediaRoutingKind;
  mimeType: string;
  /** null when the size is not known yet; the server then checks it before saving. */
  byteSize: number | null;
  /** The Inbox copy is stored and can be opened. */
  hasOriginal: boolean;
  /** Set once the file has been saved to Documents. */
  savedDocumentId: string | null;
  can: {
    /** Inbox access plus permission to manage the Document Vault. */
    saveToVault: boolean;
    openFinanceReview: boolean;
    saveToTravellerDocuments: boolean;
  };
}

export interface MediaRoutingOption {
  destination: MediaRoutingDestination;
  label: string;
  availability: "AVAILABLE" | "DONE" | "DENIED" | "UNAVAILABLE";
  /** Plain words explaining a denied or unavailable option. */
  reason: string | null;
}

export interface MediaRoutingDecision {
  options: MediaRoutingOption[];
  /** A plain note when the file cannot be read automatically; null when it can. */
  limitation: string | null;
  /** Literal by contract: routing never sends or publishes a file. */
  sendsOrPublishesAutomatically: false;
}

function normalizedMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0].trim().toLowerCase();
}

export function mediaTypeCanBeSavedToVault(mimeType: string, byteSize: number | null): boolean {
  return VAULT_MIME_TYPES.has(normalizedMimeType(mimeType)) && byteSize !== null && byteSize >= 1 && byteSize <= INBOX_MEDIA_VAULT_MAX_BYTES;
}

const COPY_UNAVAILABLE = "The Inbox copy is no longer available or is still being prepared.";
const COPY_DENIED = "Your role cannot save files to Documents.";

function option(
  destination: MediaRoutingDestination,
  label: string,
  availability: MediaRoutingOption["availability"],
  reason: string | null = null,
): MediaRoutingOption {
  return { destination, label, availability, reason };
}

function vaultOption(input: MediaRoutingInput, destination: "PROPOSAL_COLLATERAL" | "DOCUMENTS", label: string): MediaRoutingOption {
  if (input.savedDocumentId) return option(destination, label, "DONE");
  if (!input.hasOriginal) return option(destination, label, "UNAVAILABLE", COPY_UNAVAILABLE);
  if (!input.can.saveToVault) return option(destination, label, "DENIED", COPY_DENIED);
  if (!VAULT_MIME_TYPES.has(normalizedMimeType(input.mimeType))) {
    return option(destination, label, "UNAVAILABLE", "This file type cannot be saved to Documents. Download it instead.");
  }
  if (input.byteSize !== null && (input.byteSize < 1 || input.byteSize > INBOX_MEDIA_VAULT_MAX_BYTES)) {
    return option(destination, label, "UNAVAILABLE", "This file is too large to save to Documents (10 MB limit). Download it instead.");
  }
  return option(destination, label, "AVAILABLE");
}

export function mediaRoutingOptions(input: MediaRoutingInput): MediaRoutingDecision {
  const none = { sendsOrPublishesAutomatically: false as const };
  if (input.kind === "VOICE") return { options: [], limitation: null, ...none };

  const options: MediaRoutingOption[] = [];
  switch (input.kind) {
    case "BROCHURE":
      options.push(vaultOption(input, "PROPOSAL_COLLATERAL", "Save as proposal collateral"));
      break;
    case "OTHER":
      options.push(vaultOption(input, "DOCUMENTS", "Save to Documents"));
      break;
    case "RECEIPT": {
      const label = "Copy to Finance";
      options.push(
        !input.hasOriginal
          ? option("FINANCE_INTAKE", label, "UNAVAILABLE", COPY_UNAVAILABLE)
          : !financeEvidenceMimeTypeIsSupported(input.mimeType)
            ? option("FINANCE_INTAKE", label, "UNAVAILABLE", "Finance cannot review this file type. Download it instead.")
            : !input.can.openFinanceReview
              ? option("FINANCE_INTAKE", label, "DENIED", "Finance review access is required to copy this receipt.")
              : option("FINANCE_INTAKE", label, "AVAILABLE"),
      );
      break;
    }
    case "PASSPORT": {
      const label = "Save to traveller Documents";
      options.push(
        input.savedDocumentId
          ? option("TRAVELLER_DOCUMENTS", label, "DONE")
          : !input.hasOriginal
            ? option("TRAVELLER_DOCUMENTS", label, "UNAVAILABLE", COPY_UNAVAILABLE)
            : !input.can.saveToTravellerDocuments
              ? option("TRAVELLER_DOCUMENTS", label, "DENIED", "Your role cannot save traveller documents.")
              : option("TRAVELLER_DOCUMENTS", label, "AVAILABLE"),
      );
      break;
    }
  }

  options.push(
    input.hasOriginal
      ? option("DOWNLOAD", "Download the original", "AVAILABLE")
      : option("DOWNLOAD", "Download the original", "UNAVAILABLE", COPY_UNAVAILABLE),
  );

  const limitation = READABLE_MIME_TYPES.has(normalizedMimeType(input.mimeType))
    ? null
    : "This file type cannot be read automatically. Download it to open it.";
  return { options, limitation, ...none };
}
