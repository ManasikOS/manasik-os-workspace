/**
 * The text typed in the Inbox search box, made safe to send to the database. It goes into a PostgREST `or` filter, where a
 * comma, bracket or wildcard would change what the filter means, so only characters that can appear in a name, a phone
 * number or a lead reference are kept. A query that is too short to be useful is not searched at all.
 */

/** The most conversations one search returns. More than this is a reason to type more, not to page. */
export const INBOX_SEARCH_LIMIT = 50;
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 60;

export function normaliseSearchQuery(raw: string): string | null {
  const cleaned = raw
    // Letters and digits in any script (names may be Sinhala, Tamil or Arabic), plus the marks phones and references use.
    .replace(/[^\p{L}\p{N}\p{M}\s+\-.@#]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX_LENGTH)
    .trim();
  return cleaned.length >= SEARCH_MIN_LENGTH ? cleaned : null;
}
