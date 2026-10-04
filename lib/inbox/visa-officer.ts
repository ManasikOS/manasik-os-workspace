import { STAFF_ROLES, type StaffRole } from "@/lib/access/departure-groups-access";
import { capabilitiesForVisa } from "@/lib/access/visa-access";

/**
 * May this staff member be given a traveller's visa file? They must be active and hold a role that does visa work (records
 * status checks, issues and rejections), so a passport is never handed to someone who cannot open the visa module.
 * An unknown role is refused, never guessed.
 */
export function canBeVisaOfficer(profile: { role: string | null | undefined; status: string | null | undefined }): boolean {
  if (profile.status !== "ACTIVE") return false;
  const role = String(profile.role ?? "").toUpperCase();
  if (!(STAFF_ROLES as readonly string[]).includes(role)) return false;
  return capabilitiesForVisa(role as StaffRole).recordStatusCheck;
}
