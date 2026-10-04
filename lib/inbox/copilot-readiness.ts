/**
 * Copilot must not suggest a package until the details that decide the match are known. This lists what is still
 * missing from the lead, from fields the lead already stores — no model involved.
 */

export interface CopilotReadinessInput {
  desiredPackageName: string | null;
  preferredPeriod: string;
  adults: number;
  children: number;
  roomPreference: "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE" | "UNDECIDED";
}

export interface CopilotReadiness {
  ready: boolean;
  /** Plain-words names of what is still needed, in the order staff should ask. */
  stillNeeded: string[];
}

/** A polite draft that asks for what is missing. It goes into the message box for staff to read and edit — never sent. */
export function missingDetailsDraft(stillNeeded: string[]): string {
  const asked = stillNeeded.map((detail) => `- ${detail.replace(/^Package the customer wants$/, "Which package you are interested in")}`);
  return ["To find the best option for you, could you please share:", ...asked].join("\n");
}

/** A polite draft that offers to look at other dates when nothing matches. */
export const FLEXIBLE_DATES_DRAFT = "We do not have a matching departure for those dates right now. Are your travel dates flexible? We can look at nearby options for you.";

export function copilotReadinessFor(lead: CopilotReadinessInput): CopilotReadiness {
  const stillNeeded: string[] = [];
  if (!lead.desiredPackageName?.trim()) stillNeeded.push("Package the customer wants");
  if (!lead.preferredPeriod.trim()) stillNeeded.push("Travel period");
  if (lead.adults + lead.children < 1) stillNeeded.push("Number of travellers");
  if (lead.roomPreference === "UNDECIDED") stillNeeded.push("Room preference");
  return { ready: stillNeeded.length === 0, stillNeeded };
}
