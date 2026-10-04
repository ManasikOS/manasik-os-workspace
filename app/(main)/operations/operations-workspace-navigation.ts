import { OPERATIONS_TABS, type OperationsTabId } from "./types";

/**
 * Canonical URL contract for the Operations workspace: `?tab=<tab>` selects a
 * queue and `&view=<view>` selects a mode inside it. Unknown values fall back
 * to Overview (tab) or no view, so a stale or hand-edited link never 404s.
 */

export type OperationsWorkspaceSearchParams = Record<string, string | string[] | undefined>;

/** Views a tab offers. A tab absent from this map has no sub-views. */
const OPERATIONS_TAB_VIEWS = {
  accommodation: ["rooming-board"],
} as const satisfies Partial<Record<OperationsTabId, readonly string[]>>;

export type OperationsWorkspaceView = "rooming-board";

const OPERATIONS_TAB_IDS: readonly string[] = OPERATIONS_TABS.map((entry) => entry.id);

/** A repeated query key arrives as an array; treat it as ambiguous, not as its first value. */
function singleQueryValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function viewsOfTab(tab: OperationsTabId): readonly string[] {
  return (OPERATIONS_TAB_VIEWS as Partial<Record<OperationsTabId, readonly string[]>>)[tab] ?? [];
}

export function resolveOperationsWorkspaceTab(
  searchParams: OperationsWorkspaceSearchParams,
): OperationsTabId {
  const requested = singleQueryValue(searchParams.tab);
  return requested && OPERATIONS_TAB_IDS.includes(requested)
    ? (requested as OperationsTabId)
    : "overview";
}

export function resolveOperationsWorkspaceView(
  tab: OperationsTabId,
  searchParams: OperationsWorkspaceSearchParams,
): OperationsWorkspaceView | null {
  const requested = singleQueryValue(searchParams.view);
  return requested && viewsOfTab(tab).includes(requested)
    ? (requested as OperationsWorkspaceView)
    : null;
}

export function operationsWorkspaceHref(
  tab: OperationsTabId,
  view?: OperationsWorkspaceView | null,
): string {
  if (tab === "overview") return "/operations";
  const query = new URLSearchParams({ tab });
  if (view && viewsOfTab(tab).includes(view)) query.set("view", view);
  return `/operations?${query.toString()}`;
}

/** Retired top-level list pages and the Operations queue that replaces each. */
const LEGACY_OPERATIONS_REDIRECTS: Record<string, string> = {
  "/flights-tickets": operationsWorkspaceHref("flights"),
  "/transport-movements": operationsWorkspaceHref("transport"),
  "/support-incidents": operationsWorkspaceHref("support"),
  "/hotels-rooming": operationsWorkspaceHref("accommodation"),
  "/hotels-rooming/rooming-board": operationsWorkspaceHref("accommodation", "rooming-board"),
};

export function legacyOperationsRedirectHref(pathname: string): string | null {
  return LEGACY_OPERATIONS_REDIRECTS[pathname] ?? null;
}
