import { capabilitiesFor, type StaffRole } from "@/lib/access/departure-groups-access";

/**
 * A customer's passport photo, and the number, name and expiry the model read from it, are sensitive traveller data. Marketing and Finance are
 * denied that data everywhere else (`viewSensitiveTravellerData`), so the Inbox must not hand it to them either: not the photo link, not the
 * read-out. The roles are the same ones the database policy `can_view_passport_media()` names (see passport-visibility-migration.test.ts).
 */
export function canViewPassportMedia(role: StaffRole): boolean {
  return capabilitiesFor(role).viewSensitiveTravellerData;
}

export const PASSPORT_RESTRICTED_NOTE = "Passport photo: only Operations and Visa staff, and administrators, can open it.";

interface ArtifactAttachment { id: string; original_href: string | null; filename: string | null }
interface ArtifactAnalysis { attachment_id: string; kind: string }

/**
 * Removes what a role without passport access must not receive. A passport attachment keeps its row (so the thread still shows that a file was
 * sent) but loses its link and its file name, and is marked `restricted` so the screen says why instead of waiting for it to load. The model's
 * read-out of a passport is dropped entirely.
 */
export function withholdPassportMedia<A extends ArtifactAttachment, M extends ArtifactAnalysis>(input: {
  attachments: A[];
  mediaAnalyses: M[];
  passportAttachmentIds: ReadonlySet<string>;
}): { attachments: Array<A & { restricted: boolean }>; mediaAnalyses: M[] } {
  const { passportAttachmentIds } = input;
  return {
    attachments: input.attachments.map((attachment) =>
      passportAttachmentIds.has(attachment.id)
        ? { ...attachment, original_href: null, filename: null, restricted: true }
        : { ...attachment, restricted: false },
    ),
    mediaAnalyses: input.mediaAnalyses.filter((analysis) => analysis.kind !== "PASSPORT" && !passportAttachmentIds.has(analysis.attachment_id)),
  };
}
