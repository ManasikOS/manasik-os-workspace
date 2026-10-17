/**
 * What the Dashboard role-matrix spec expects on each role's page — pure, so
 * it is unit-tested and shared by the spec without a browser.
 *
 * Derived from the same registry the page renders from
 * (`resolveDashboardLayout` + `visibleBlocks` over the role's built-in
 * capabilities). That makes "the page equals the registry" the integration
 * property under test; the *independent* guarantees (a GUIDE never sees
 * money) are asserted by hard-coded lists in the unit test and the spec, so
 * editing presets and gates together cannot quietly widen a role.
 */

import { baseDashboardCapabilities, visibleBlocks } from "@/lib/access/dashboard-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { DASHBOARD_PANEL_IDS, resolveDashboardLayout, type DashboardPanelId } from "@/lib/data/dashboard-layout";

/**
 * Visible to the role, but only rendered when the agency's plan includes the
 * owner panel - so absence is not a failure. (Presence for a role that is
 * not allowed it always is.)
 */
export const ENTITLEMENT_DEPENDENT_BLOCKS: readonly DashboardPanelId[] = ["inbox-owner"];

/**
 * Text that appears only on a block's card, used to prove a forbidden
 * block's content is not in the document (and so not in the RSC payload
 * either). Only blocks with a title distinctive enough not to collide with
 * navigation or shared copy are listed.
 */
export const BLOCK_DISTINCTIVE_TEXT: Partial<Record<DashboardPanelId, string>> = {
  collections: "Collections & Payment Attention",
  "supplier-payables": "Supplier payables",
  "visa-queue": "Visa queue",
  "document-review": "Document review",
  "campaign-pulse": "Campaign pulse",
  "quotes-pending": "Quotes pending",
};

/** Blocks this built-in role's page may render (before data-dependent absence). */
export function expectedBlocksFor(role: StaffRole): DashboardPanelId[] {
  return visibleBlocks(resolveDashboardLayout(role), baseDashboardCapabilities(role));
}

/** Blocks that must not be on this role's page at all. */
export function forbiddenBlocksFor(role: StaffRole): DashboardPanelId[] {
  const expected = new Set<DashboardPanelId>(expectedBlocksFor(role));
  return DASHBOARD_PANEL_IDS.filter((id) => !expected.has(id));
}

/** Blocks that must be present: expected, minus those a plan entitlement can legitimately remove. */
export function mustBePresentBlocksFor(role: StaffRole): DashboardPanelId[] {
  return expectedBlocksFor(role).filter((id) => !ENTITLEMENT_DEPENDENT_BLOCKS.includes(id));
}
