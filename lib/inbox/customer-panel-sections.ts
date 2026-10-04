/**
 * Which sections of the customer panel are open. The panel is a list of collapsible sections so the person sees the
 * customer and the next step first and opens the rest when they need it. Their choice is remembered per browser.
 */
export const CUSTOMER_PANEL_SECTION_IDS = [
  "trip",
  "booking",
  "follow-up",
  "copilot",
  "work",
  "history",
] as const;

export type CustomerPanelSectionId = (typeof CUSTOMER_PANEL_SECTION_IDS)[number];

/** What a person who never chose sees: the trip being planned and the booking, nothing else. */
export const DEFAULT_OPEN_CUSTOMER_PANEL_SECTIONS: readonly CustomerPanelSectionId[] = ["trip", "booking"];

function isCustomerPanelSectionId(value: unknown): value is CustomerPanelSectionId {
  return typeof value === "string" && (CUSTOMER_PANEL_SECTION_IDS as readonly string[]).includes(value);
}

/** Reads what was stored. Anything missing, unreadable or from an older version falls back to the defaults. */
export function parseOpenCustomerPanelSections(raw: string | null): CustomerPanelSectionId[] {
  if (raw === null) return [...DEFAULT_OPEN_CUSTOMER_PANEL_SECTIONS];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_OPEN_CUSTOMER_PANEL_SECTIONS];
    // An empty list is a real choice (everything closed), so only unknown ids are dropped.
    return parsed.filter(isCustomerPanelSectionId);
  } catch {
    return [...DEFAULT_OPEN_CUSTOMER_PANEL_SECTIONS];
  }
}

export function serializeOpenCustomerPanelSections(open: readonly string[]): string {
  return JSON.stringify(open.filter(isCustomerPanelSectionId));
}
