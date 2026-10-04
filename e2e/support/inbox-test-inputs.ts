export const PHONE_VIEWPORT = { width: 375, height: 812 } as const;

/** The address of the Inbox for an optional view and conversation, matching `inboxPageHref` in lib/inbox/page-request.ts. */
export function inboxAddress(input: { view?: string; conversationId?: string } = {}): string {
  const params = new URLSearchParams();
  if (input.view) params.set("view", input.view);
  if (input.conversationId) params.set("conversation", input.conversationId);
  const query = params.toString();
  return query ? `/inbox?${query}` : "/inbox";
}

/** The distinctive search fixtures the search tests need. Missing values fail the test loudly: a skipped step is not a pass. */
export function requireSearchFixtures(values: Record<string, string | undefined> = process.env): { agencyATerm: string; agencyBTerm: string } {
  const agencyATerm = values.INBOX_E2E_A_SEARCH_TERM?.trim();
  const agencyBTerm = values.INBOX_E2E_B_SEARCH_TERM?.trim();
  const missing = [!agencyATerm && "INBOX_E2E_A_SEARCH_TERM", !agencyBTerm && "INBOX_E2E_B_SEARCH_TERM"].filter(Boolean);
  if (missing.length > 0 || !agencyATerm || !agencyBTerm) {
    throw new Error(
      `Missing search fixture variable(s): ${missing.join(", ")}. Set INBOX_E2E_A_SEARCH_TERM to text found only in an Agency A conversation, and INBOX_E2E_B_SEARCH_TERM to text found only in Agency B's.`,
    );
  }
  if (agencyATerm.toLowerCase() === agencyBTerm.toLowerCase()) throw new Error("The Agency A and Agency B search terms must be different.");
  return { agencyATerm, agencyBTerm };
}

/** The staff member a conversation is handed to in the ownership and bulk tests, as their name appears in the owner picker. */
export function requireOwnerFixture(values: Record<string, string | undefined> = process.env): { colleagueName: string } {
  const colleagueName = values.INBOX_E2E_A2_NAME?.trim();
  if (!colleagueName) throw new Error("Missing INBOX_E2E_A2_NAME: the name Staff A2 shows in the owner picker (Agency A).");
  return { colleagueName };
}

/** An approved WhatsApp template that exists for Agency A, by the name shown in the template picker. */
export function requireTemplateFixture(values: Record<string, string | undefined> = process.env): { templateName: string } {
  const templateName = values.INBOX_E2E_TEMPLATE_NAME?.trim();
  if (!templateName) throw new Error("Missing INBOX_E2E_TEMPLATE_NAME: the name of an approved WhatsApp template for Agency A.");
  return { templateName };
}

/**
 * How many conversations a view holds, from the count line under its title: "12 conversations" or "Showing 50 of 120". The second form
 * is the true total, so it wins over the number of rows loaded.
 */
export function parseViewTotal(countLine: string): number {
  const showing = countLine.match(/^Showing \d+ of (\d+)$/);
  if (showing) return Number(showing[1]);
  const plain = countLine.match(/^(\d+) conversations?$/);
  if (plain) return Number(plain[1]);
  throw new Error(`Unrecognised conversation count line: "${countLine}"`);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A buffer that starts with a real PNG signature and is `byteSize` long. The server judges a file by its own bytes, not its name. */
export function pngLikeBuffer(byteSize: number): Buffer {
  if (byteSize < PNG_SIGNATURE.length) throw new Error("A PNG-like buffer needs at least 8 bytes.");
  const buffer = Buffer.alloc(byteSize);
  Buffer.from(PNG_SIGNATURE).copy(buffer);
  return buffer;
}
