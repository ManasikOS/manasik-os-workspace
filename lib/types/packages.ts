/**
 * Domain sub-types shared by the `packages` database row (`lib/types/database.ts`)
 * and the create-package wizard (`app/(main)/packages/create-package/types.ts`).
 *
 * Previously defined inside the wizard's route folder and imported backwards
 * into the data layer. Living here means the data layer no longer depends on
 * a page's component folder.
 */

export type JourneyType = "Umrah" | "Hajj" | "Early Registration";
export type PackageStatus = "Draft" | "Open for Sale" | "Sales Closed" | "Archived";
export type PackageCategory = "Economy" | "Standard" | "Premium" | "VIP" | "Custom";
export type PackageVisibility = "Internal Only" | "Pilgrim Portal" | "Website & Portal";
export type SeatHoldExpiry = "6 hours" | "12 hours" | "24 hours" | "48 hours";

export interface ItineraryItem {
  id: string;
  dayNumber: number;
  title: string;
  location?: string;
  description: string;
  category?: "Flight" | "Arrival" | "Hotel" | "Transfer" | "Ritual" | "Ziyarah" | "Ziyarat" | "Meal" | "Free Time" | "Departure" | "Other";
  internalNotes?: string;
}

export interface PaymentMilestone {
  id: string;
  label: string;
  amountType: "Fixed Amount" | "Percentage" | "Remaining Balance";
  amount: number | "";
  dueRule: "On Booking" | "Fixed Date" | "Days Before Departure";
  dueDate?: string;
  daysBeforeDeparture?: number | "";
  refundable: boolean;
  notes?: string;
}

export interface InternalFinanceEstimate {
  flightCostPerPilgrim: number | "";
  accommodationCostPerPilgrim: number | "";
  transportCostPerPilgrim: number | "";
  visaInsuranceCostPerPilgrim: number | "";
  cateringCostPerPilgrim: number | "";
  guideOperationsCostPerPilgrim: number | "";
  contingencyCostPerPilgrim: number | "";
}

export interface TransportRequirement {
  id: string;
  routeLabel: string;
  startLocation: string;
  destination: string;
  required: boolean;
  vehicleStandard: "Bus" | "Private Car" | "Train" | "Other";
  vehicleNotes: string;
  state: "Included" | "Optional";
  internalNotes?: string;
}

export interface DocumentRequirement {
  id: string;
  name: string;
  category: "Passport" | "Identity" | "Visa" | "Medical" | "Finance" | "Travel" | "Other";
  required: boolean;
  requiredByStage: "On Booking" | "Before Visa Submission" | "Before Final Payment" | "Before Departure";
  verifiedByRole: "Admin" | "Operations" | "Visa" | "Finance";
  visibleInPortal: boolean;
}

export interface GroupReadinessRequirement {
  id: string;
  label: string;
  required: boolean;
  responsibleRole: "Operations" | "Visa" | "Finance" | "Guide" | "Admin";
  dueTiming: string;
}

export interface FlightLeg {
  id: string;
  legNumber: number;
  airline: string;
  flightNo: string;
  departureAirport: string;
  departureTime: string;
  arrivalAirport: string;
  arrivalTime: string;
}

export interface FlightRoute {
  id: string;
  routeName: string;
  flightType: "Direct" | "Transit";
  airline: string;
  flightNo?: string;
  departureAirport: string;
  departureTime: string;
  arrivalAirport: string;
  arrivalTime: string;
  flightLegs: FlightLeg[];
}

export interface FlightOption {
  id: string;
  optionName: string;
  outbound: FlightRoute;
  return: FlightRoute;
}

/** The seven wizard steps, in order — used for validity/completeness maps. */
export const PACKAGE_WIZARD_STEP_TITLES = [
  "Commercial Identity",
  "Sales Offer & Pricing",
  "Journey Template",
  "Service Standards",
  "Traveller Requirements",
  "Group Creation Defaults",
  "Review & Publish",
] as const;

export const PACKAGE_WIZARD_STEP_COUNT = 6;

/* ── List screen ──────────────────────────────────────────────────────────── */

// "Archived" was never a reachable saved view here — the list only ever
// shows active packages (archived rows have their own separate sheet,
// `ArchivedPackagesSheet`), so a "savedView" state could never actually be
// set to it. See docs/modules/packages-production-readiness-plan.md, finding E6.
export const PACKAGE_SAVED_VIEWS = [
  "All Packages",
  "Open for Sale",
  "My Drafts",
  "Featured",
  "Needs Attention",
] as const;
export type PackageSavedView = (typeof PACKAGE_SAVED_VIEWS)[number];

export interface PackageListItem {
  id: string;
  code: string;
  title: string;
  journeyType: JourneyType;
  category: "Umrah" | "Hajj";
  packageCategory: PackageCategory;
  branch: string;
  status: PackageStatus;
  visibility: PackageVisibility;
  featured: boolean;
  durationDays: number;
  durationNights: number;
  durationLabel: string;
  itineraryDays: number;
  completeness: number;
  missingSteps: number[];
  groupCount: number;
  liveGroupCount: number;
  seatsBooked: number;
  seatsCapacity: number;
  archived: boolean;
  updatedAt: string;
  ownerId: string | null;
}

/** One row from `package_activity_logs` — a lifecycle transition (publish/close sales/reopen/archive/restore). */
export interface PackageActivityLog {
  id: string;
  actorName: string;
  actionType: "PUBLISHED" | "SALES_CLOSED" | "REOPENED" | "ARCHIVED" | "RESTORED";
  beforeStatus: PackageStatus | null;
  afterStatus: PackageStatus;
  reason: string | null;
  message: string;
  createdAt: string;
}

export interface PackageListKpis {
  openForSale: number;
  draftsInProgress: number;
  liveGroups: number;
  seatsBooked: number;
  seatsCapacity: number;
}
