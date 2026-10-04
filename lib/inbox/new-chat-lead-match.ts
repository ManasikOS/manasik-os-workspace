/**
 * What the new-chat dialog says about the number typed in, before anything is sent: which existing lead the chat will attach
 * to, or that none will be created. Sending a template never creates a lead (that is an explicit Inbox action), so
 * "No lead yet" is an accurate promise, not a guess.
 */

/** The digits of what was typed, or null until it could be a full international number (8–15 digits, as the server requires). */
export function dialableDigits(input: string): string | null {
  const digits = input.replace(/[^\d]/g, "");
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export interface LeadMatchPreview {
  name: string;
  reference: string;
}

export function leadMatchMessage(matches: readonly LeadMatchPreview[]): { tone: "LINKED" | "NONE" | "AMBIGUOUS"; text: string } {
  if (matches.length === 0) {
    return { tone: "NONE", text: "No lead uses this number yet. Sending will not create one; you can add a lead from the chat afterwards." };
  }
  if (matches.length === 1) {
    return { tone: "LINKED", text: `This chat will be linked to ${matches[0].name} (${matches[0].reference}).` };
  }
  return { tone: "AMBIGUOUS", text: "More than one lead uses this number. The chat will not be linked to any of them; choose the right lead from Leads afterwards." };
}
