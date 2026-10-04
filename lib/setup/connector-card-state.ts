/** The five states a connector card can be in (docs/onboarding/plan.md §5.3). */
export type ConnectorCardState = "NOT_CONNECTED" | "CONNECTING" | "CONNECTED" | "NEEDS_ATTENTION" | "UNAVAILABLE";

const NOT_CONNECTED_STATUSES = new Set(["NOT_CONNECTED", "DISCONNECTED"]);
const CONNECTING_STATUSES = new Set(["PENDING", "PENDING_REVIEW", "CONNECTING"]);

/**
 * Maps a provider's own status vocabulary onto the card's five states. A live
 * connection always shows as connected and a broken one as needing attention,
 * whatever the environment says; "not available" only replaces a card that
 * has nothing to show and no way to start — so it never hides real state.
 */
export function resolveConnectorCardState(input: { rawStatus: string | null; available: boolean }): ConnectorCardState {
  const status = input.rawStatus;

  if (status === "CONNECTED") return "CONNECTED";
  if (status === null || NOT_CONNECTED_STATUSES.has(status)) return input.available ? "NOT_CONNECTED" : "UNAVAILABLE";
  if (CONNECTING_STATUSES.has(status)) return "CONNECTING";
  return "NEEDS_ATTENTION";
}
