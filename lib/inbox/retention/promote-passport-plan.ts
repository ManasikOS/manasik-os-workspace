/**
 * The decisions behind "Save to Documents" for a passport a customer sent in chat. Everything that can be decided
 * without touching storage or the database lives here so it can be tested: which traveller, which checklist item,
 * whether the file may be copied, and where it goes. The action in app/inbox/actions.ts only does the I/O.
 */

/** Same limits as the Documents module's own upload (app/(main)/departure-groups/document-storage.ts). */
export const PASSPORT_PROMOTION_MAX_BYTES = 10 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export type PassportPromotionRefusal = { ok: false; error: string };

/** The traveller the passport belongs to: the one staff chose, or the only candidate. Never a guess between several. */
export function resolvePassportTraveller(input: {
  selectedTravellerId: string | null;
  candidateTravellerIds: string[];
  /** Travellers on the conversation's booking. */
  bookingTravellerIds: string[];
}): { ok: true; travellerId: string } | PassportPromotionRefusal {
  const chosen = input.selectedTravellerId ?? (input.candidateTravellerIds.length === 1 ? input.candidateTravellerIds[0] : null);
  if (!chosen) return { ok: false, error: "Choose which traveller this passport belongs to first." };
  if (!input.bookingTravellerIds.includes(chosen)) return { ok: false, error: "That traveller is not on this conversation's booking." };
  return { ok: true, travellerId: chosen };
}

export interface PassportChecklistItem {
  id: string;
  status: "NOT_SUBMITTED" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "NOT_APPLICABLE";
  documentType: string;
}

/**
 * The traveller's passport photo-page checklist item, if it can safely take a new file. A file already waiting for
 * review or already verified is never silently replaced: a person decides that in Documents.
 */
export function choosePassportChecklistItem(items: PassportChecklistItem[]): { ok: true; item: PassportChecklistItem } | PassportPromotionRefusal {
  const item = items.find((candidate) => candidate.documentType === "PASSPORT_BIO");
  if (!item) return { ok: false, error: "This traveller has no passport item on their document checklist." };
  switch (item.status) {
    case "NOT_SUBMITTED":
    case "REJECTED":
      return { ok: true, item };
    case "SUBMITTED":
      return { ok: false, error: "A passport is already waiting for review in Documents. Open Documents to replace it." };
    case "VERIFIED":
      return { ok: false, error: "This traveller's passport is already verified. It cannot be replaced from the Inbox." };
    case "NOT_APPLICABLE":
      return { ok: false, error: "A passport is marked not needed for this traveller." };
  }
}

/**
 * After a failed submit, may this request delete the copy it uploaded? Only when nothing points at it. The path is built from the checklist item,
 * so another save to the same item (a second passport of the same traveller) writes the very same path; if the item now points at it, the file is
 * that save's and must stay. If the item could not be read, the copy is kept: an orphan is better than a deleted passport.
 */
export function mayRemoveUnsubmittedCopy(input: { readFailed: boolean; itemFilePath: string | null; destinationPath: string }): boolean {
  if (input.readFailed) return false;
  return input.itemFilePath !== input.destinationPath;
}

/** May this stored inbox file be copied into Documents? */
export function checkPassportFileForPromotion(input: { mimeType: string; sizeBytes: number }): { ok: true; extension: string } | PassportPromotionRefusal {
  const extension = EXTENSION_BY_MIME[input.mimeType];
  if (!extension) return { ok: false, error: "Only a PDF or a photo (JPG, PNG, WEBP or HEIC) can be saved to Documents." };
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false, error: "That file appears to be empty." };
  if (input.sizeBytes > PASSPORT_PROMOTION_MAX_BYTES) return { ok: false, error: "Files must be 10 MB or smaller." };
  return { ok: true, extension };
}

/**
 * Where the copy lives in the private `pilgrim-documents` bucket. Built only from server-resolved ids, and the extension
 * comes from the checked MIME type, never from the customer's filename. Matches the layout the Documents upload uses.
 */
export function passportDocumentPath(input: { agencyId: string; departureGroupId: string; pilgrimId: string; documentId: string; extension: string }): { path: string; fileName: string } {
  const fileName = `${input.documentId}.${input.extension}`;
  return { path: `${input.agencyId}/${input.departureGroupId}/${input.pilgrimId}/${fileName}`, fileName };
}
