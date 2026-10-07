export const GLOBAL_SEARCH_GROUPS = [
  "lead",
  "pilgrim",
  "booking",
  "departure_group",
  "package",
  "supplier",
  "invoice",
  "team_member",
] as const;

export type GlobalSearchGroup = (typeof GLOBAL_SEARCH_GROUPS)[number];

export const GLOBAL_SEARCH_GROUP_LABELS: Record<GlobalSearchGroup, string> = {
  lead: "Leads",
  pilgrim: "Pilgrims",
  booking: "Bookings",
  departure_group: "Departure groups",
  package: "Packages",
  supplier: "Suppliers",
  invoice: "Invoices",
  team_member: "Team",
};

/** One search hit: what to show, and the page it opens. */
export interface GlobalSearchHit {
  id: string;
  group: GlobalSearchGroup;
  title: string;
  subtitle: string;
  href: string;
}

export type GlobalSearchResult =
  | { ok: true; data: GlobalSearchHit[] }
  | { ok: false; error: string };

/** A page in the app that can be jumped to by name. */
export interface GlobalSearchPage {
  title: string;
  href: string;
  keywords: string;
}
