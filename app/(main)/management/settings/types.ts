import type { SettingsCapabilities } from "@/lib/access/settings-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { AgencySettingsRow } from "@/lib/types/settings";

/**
 * View models shared by the section clients. Every section page passes the
 * same shape down so `<SectionShell>` and the nav never need a per-section
 * special case.
 */
export interface SettingsPageContext {
  role: StaffRole;
  can: SettingsCapabilities;
  settings: AgencySettingsRow;
}
