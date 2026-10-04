/**
 * How much room each Inbox pane gets at a given screen width. The open conversation is the focal point, so the side
 * panes give way to it: the customer panel only docks when the thread would still be comfortable, and the queue rail
 * folds to icons on laptop widths. A person's own choice always wins over these defaults.
 */

/** Fixed pane widths in px; the rail widths are set in `inbox-view-rail.tsx` (`--sidebar-width`, `--sidebar-width-icon`), the panel is `w-85`. */
export const INBOX_PANE_WIDTH_PX = {
  railExpanded: 216,
  railCollapsed: 48,
  conversationList: 320,
  customerPanel: 340,
} as const;

/** The narrowest the open conversation should get by default before a side pane folds away. */
export const INBOX_THREAD_MIN_WIDTH_PX = 560;

/** Below this the rail is hidden entirely and the compact queue bar takes over (Tailwind `lg`). */
export const INBOX_RAIL_MIN_VIEWPORT_PX = 1024;
/** From here the customer panel docks beside the thread as a rail; below it opens as a sheet (Tailwind `xl`). */
export const INBOX_PANEL_DOCK_MIN_VIEWPORT_PX = 1280;
/** From here the queue rail is expanded by default; between the two widths above it starts folded to icons so the thread keeps its room. */
export const INBOX_RAIL_EXPANDED_MIN_VIEWPORT_PX = 1440;

export type InboxViewportTier = "narrow" | "laptop" | "desktop" | "wide";

/** A small, stable label for the width, so a component re-renders when the layout changes and not on every pixel. */
export function inboxViewportTier(viewportWidth: number): InboxViewportTier {
  if (viewportWidth >= INBOX_RAIL_EXPANDED_MIN_VIEWPORT_PX) return "wide";
  if (viewportWidth >= INBOX_PANEL_DOCK_MIN_VIEWPORT_PX) return "desktop";
  if (viewportWidth >= INBOX_RAIL_MIN_VIEWPORT_PX) return "laptop";
  return "narrow";
}

export type InboxRailChoice = "expanded" | "collapsed";
export type InboxPanelChoice = "open" | "closed";

export type InboxLayoutBudget = {
  railCollapsed: boolean;
  /** True when the customer panel sits beside the thread; false when it opens as a sheet. */
  panelDocked: boolean;
  /** Only meaningful while docked. */
  panelOpen: boolean;
  /** Width left for the open conversation at the representative width of the tier. */
  threadWidthPx: number;
};

/** The smallest width in each tier, used to report the worst-case room left for the thread. */
const TIER_REPRESENTATIVE_WIDTH_PX: Record<InboxViewportTier, number> = {
  narrow: 0,
  laptop: INBOX_RAIL_MIN_VIEWPORT_PX,
  desktop: INBOX_PANEL_DOCK_MIN_VIEWPORT_PX,
  wide: INBOX_RAIL_EXPANDED_MIN_VIEWPORT_PX,
};

export function inboxLayoutBudget({
  tier,
  railChoice,
  panelChoice,
}: {
  tier: InboxViewportTier;
  /** What the person picked last, or null if they never chose. */
  railChoice: InboxRailChoice | null;
  panelChoice: InboxPanelChoice | null;
}): InboxLayoutBudget {
  const railCollapsed = railChoice ? railChoice === "collapsed" : tier !== "wide";
  const panelDocked = tier === "desktop" || tier === "wide";
  const panelOpen = panelChoice ? panelChoice === "open" : true;

  const railPx = railCollapsed
    ? INBOX_PANE_WIDTH_PX.railCollapsed
    : INBOX_PANE_WIDTH_PX.railExpanded;
  const railShownPx = tier === "narrow" ? 0 : railPx;
  const panelPx = panelDocked && panelOpen ? INBOX_PANE_WIDTH_PX.customerPanel : 0;
  const threadWidthPx =
    TIER_REPRESENTATIVE_WIDTH_PX[tier] -
    railShownPx -
    INBOX_PANE_WIDTH_PX.conversationList -
    panelPx;

  return { railCollapsed, panelDocked, panelOpen, threadWidthPx };
}
