/**
 * Role-based access for the Bookings module — Phase 0 (P0.3) registration;
 * real page lands in Phase 1 (P1.5) of
 * docs/modules/manasik-intelligence-build-roadmap.md. Placeholder capability set —
 * see `lib/access/module-defaults.ts`'s doc comment for why, and
 * `docs/architecture/remaining-modules-master-plan.md` §6 for the target key list this
 * mirrors.
 */

import { buildPlaceholderCapabilities } from "@/lib/access/module-defaults";
import type { StaffRole } from "@/lib/access/departure-groups-access";

export interface BookingsCapabilities {
  viewModule: boolean;
  createBooking: boolean;
  editCommercials: boolean;
  addTraveller: boolean;
  changePackageOrGroup: boolean;
  transferBooking: boolean;
  cancelBooking: boolean;
  approveDiscount: boolean;
  viewFinancials: boolean;
  viewSensitiveTravellerData: boolean;
  assignOwners: boolean;
  exportBookings: boolean;
  assignedGroupOnly: boolean;
}

const CAPABILITIES: Record<StaffRole, BookingsCapabilities> = buildPlaceholderCapabilities<BookingsCapabilities>([
  "viewModule",
  "createBooking",
  "editCommercials",
  "addTraveller",
  "changePackageOrGroup",
  "transferBooking",
  "cancelBooking",
  "approveDiscount",
  "viewFinancials",
  "viewSensitiveTravellerData",
  "assignOwners",
  "exportBookings",
  "assignedGroupOnly",
]);

export function capabilitiesForBookings(role: StaffRole): BookingsCapabilities {
  return CAPABILITIES[role];
}
