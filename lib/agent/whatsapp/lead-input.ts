/**
 * Limits on what the WhatsApp assistant may write into a lead.
 *
 * The tool schemas it is given are guidance for the model, not a boundary: the model fills them from a customer's messages, and nothing stopped a
 * 50 000-character "city", an "e-mail" that is a paragraph, or `adults: 900000`. Those values are later shown to staff, exported to CSV and fed to
 * the copilot's language model, so they are bounded and cleaned here, on the server, before they are stored.
 */

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}$/;

export const AGENT_FIELD_LIMITS = {
  fullName: 120,
  city: 80,
  departureCity: 80,
  interestedIn: 200,
  preferredPeriod: 120,
  budgetRange: 80,
  note: 1000,
  email: 254,
  maxTravellers: 20,
} as const;

const LINE_SEPARATOR = 0x2028;
const PARAGRAPH_SEPARATOR = 0x2029;

/**
 * Characters with no place in a name or a note: C0/C1 controls, zero-width characters, and the bidirectional overrides and isolates that can make
 * text read differently from how it is stored. Tab, line feed and carriage return are handled by the callers.
 */
function isStrippable(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  if (code >= 0x200b && code <= 0x200f) return true;
  if (code >= 0x202a && code <= 0x202e) return true;
  if (code >= 0x2066 && code <= 0x2069) return true;
  return code === 0xfeff;
}

function stripControl(value: string, keepLineBreaks: boolean): string {
  let out = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === LINE_SEPARATOR || code === PARAGRAPH_SEPARATOR) {
      out += keepLineBreaks ? "\n" : " ";
    } else if (!isStrippable(code)) {
      out += character;
    }
  }
  return out;
}

/** Removes control and bidirectional-override characters, collapses whitespace, and cuts to `max` characters. Single line. */
export function cleanLine(value: string, max: number): string {
  return stripControl(value, false).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Like `cleanLine` but keeps line breaks (for a note). */
export function cleanText(value: string, max: number): string {
  return stripControl(value, true)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** The e-mail address, or null when what the customer typed is not one. Never a "best effort" slice of a longer string. */
export function cleanEmail(value: string): string | null {
  const candidate = stripControl(value, false).trim();
  if (candidate.length === 0 || candidate.length > AGENT_FIELD_LIMITS.email) return null;
  return EMAIL.test(candidate) ? candidate : null;
}

/** A head-count within what one enquiry can plausibly mean; anything else is ignored rather than clamped to a number nobody said. */
export function cleanTravellerCount(value: unknown, min: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < min || value > AGENT_FIELD_LIMITS.maxTravellers) return null;
  return value;
}
