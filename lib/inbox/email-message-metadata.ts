/**
 * Email-only fields (subject, Cc, Bcc) live in `conversation_messages.metadata`, not as columns —
 * the same precedent as Messenger's `metadata.part_mids` (docs/inbox/email-channel-implementation-plan.md,
 * Phase 3). Pure, so the UI never scatters `as` casts over an untyped jsonb value.
 */

export interface EmailMessageMetadata {
  subject: string | null;
  cc: string[];
  bcc: string[];
}

function stringArrayOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function emailMetadataOf(metadata: Record<string, unknown> | null | undefined): EmailMessageMetadata {
  const subject = metadata?.subject;
  return {
    subject: typeof subject === "string" && subject.trim() ? subject : null,
    cc: stringArrayOf(metadata?.cc),
    bcc: stringArrayOf(metadata?.bcc),
  };
}

/** What the composer's Cc/Bcc fields hold: a comma/semicolon-separated typed list. Blank entries are dropped, never sent as "". */
export function parseAddressList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
