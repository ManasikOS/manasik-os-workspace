
import type {
  DocumentRequirement,
  GroupReadinessRequirement,
  ItineraryItem,
  JourneyType,
  PackageCategory,
  PackageStatus,
  PackageVisibility,
  PaymentMilestone,
  SeatHoldExpiry,
  TransportRequirement,
} from "@/lib/types/packages";

// Re-exported so existing imports of these types from this module keep working.
export type {
  DocumentRequirement,
  FlightLeg,
  FlightOption,
  FlightRoute,
  GroupReadinessRequirement,
  ItineraryItem,
  JourneyType,
  PackageCategory,
  PackageStatus,
  PackageVisibility,
  PaymentMilestone,
  SeatHoldExpiry,
  TransportRequirement,
} from "@/lib/types/packages";

export interface PackageFormData {
  // Step 1: Commercial Identity
  title: string;
  internalCode: string;
  description: string;
  journeyType: JourneyType;
  category: "Hajj" | "Umrah";
  year: number | string;
  package_category: PackageCategory;
  branch: string;
  visibility: PackageVisibility;
  status: PackageStatus;
  featured: boolean;
  defaultCapacity: number | "";
  minGroupSize: number | "";
  waitlistEnabled: boolean;
  seatHoldExpiry: SeatHoldExpiry;
  suggestedGuideRatio: number | "";
  maxPilgrims: number | "";
  // Length is genuinely reusable across departures — moved here (from the
  // old Journey Template step) alongside the rest of Package Classification.
  days: number;
  nights: number;
  duration: string;

  // Step 2: Pricing POLICY — the schedule structure and customer-facing
  // rules are reusable across every departure. Room-occupancy prices, the
  // early-bird price/date, the deposit amount, and the internal cost
  // estimate are NOT reusable (a template's price is not what every
  // departure sells at) — those are collected per Departure Group now, see
  // docs/architecture/package-departure-architecture-master-plan.md Phase 2/4.
  paymentMilestones: PaymentMilestone[];
  paymentTerms: string;
  cancellationPolicy: string;
  latePaymentPolicy: string;
  priceChangeDisclaimer: string;
  financeRoleView: "Admin" | "CEO" | "Finance" | "Marketing";

  itinerary: ItineraryItem[];

  // Step 4: Service Standards
  includedServices: string[];
  makkahAccommodationStandard: string;
  makkahCustomerWording: string;
  makkahNights: number;
  makkahOccupancies: string[];
  makkahTargetDistance: string;
  makkahMealPlan: string;
  makkahExactHotelGuarantee: boolean;
  makkahHotel: string;
  makkahExactDisplayName: string;
  madinahAccommodationStandard: string;
  madinahCustomerWording: string;
  madinahNights: number;
  madinahOccupancies: string[];
  madinahTargetDistance: string;
  madinahMealPlan: string;
  madinahExactHotelGuarantee: boolean;
  madinahHotel: string;
  madinahExactDisplayName: string;
  transportType: string;
  transportRequirements: TransportRequirement[];
  inclusions: string[];
  exclusions: string[];
  customInclusionInput: string;
  customExclusionInput: string;

  // Step 5: Traveller Requirements
  documentRequirements: DocumentRequirement[];
  seatReservationRule: string;
  selectedCommunicationTemplates: string[];

  // Step 6: Group Creation Defaults
  defaultGroupCapacity: number | "";
  defaultGroupStatus: string;
  groupReadinessChecklist: GroupReadinessRequirement[];

  // Legacy / metadata flags
  startDate: string;
  endDate: string;
  guide: string;
}

export const GUIDES = [
  { title: "M.S.M Shafaath" },
  { title: "M.N.M Ajmal" },
  { title: "M. Nilfath" },
  { title: "M.S.M Shahrin" },
];


export const DESCRIPTION_TEMPLATE = [
  {
    template: "Standard Umrah",
    category: "Umrah",
    best: "Regular group Umrah",
    content: "A guided Umrah journey designed for pilgrims seeking a comfortable and well-organised stay in Makkah and Madinah. The package includes accommodation, local transport, guided religious support, and a planned itinerary.",
  },
  {
    template: "Ramadan Umrah",
    category: "Umrah",
    best: "Ramadan departures",
    content: "A spiritually focused Ramadan Umrah journey with organised accommodation, transport, guidance, and a planned Makkah and Madinah itinerary. Designed to help pilgrims concentrate on worship during the blessed month.",
  },
  {
    template: "Economy Umrah",
    category: "Umrah",
    best: "Price-sensitive groups",
    content: "A value-focused Umrah package offering essential travel, accommodation, transport, and guidance services for pilgrims seeking a reliable and affordable journey.",
  },
  {
    template: "Premium Umrah",
    category: "Umrah",
    best: "Higher-end offer",
    content: "A premium Umrah experience with carefully selected accommodation, comfortable travel arrangements, guided support, and a thoughtfully planned pilgrimage itinerary.",
  },
  {
    template: "Private Family Umrah",
    category: "Umrah",
    best: "Family/custom bookings",
    content: "A flexible private Umrah package tailored for families or small groups, with customisable travel dates, accommodation preferences, transport arrangements, and guided support.",
  },
  {
    template: "School Holiday Umrah",
    category: "Umrah",
    best: "Family vacation period",
    content: "An Umrah journey scheduled during school holidays, tailored for families traveling together with dedicated child support and family rooming options.",
  },
  {
    template: "Standard Hajj",
    category: "Hajj",
    best: "Main Hajj offer",
    content: "A comprehensive Hajj pilgrimage package including Aziziyah / Makkah hotel stay, Mina & Arafat tent arrangements, full board catering, Mutawwif guidance, and transfers.",
  },
  {
    template: "Premium Hajj",
    category: "Hajj",
    best: "Luxury Hajj package",
    content: "An upgraded Hajj package featuring 5-star Makkah & Madinah hotels near the Harams, upgraded VIP Mina tents with private bath facilities, and dedicated religious scholars.",
  },
  {
    template: "VIP Hajj",
    category: "Hajj",
    best: "Exclusive VIP offer",
    content: "An elite VIP Hajj experience with luxury suite accommodations, private bullet train / VIP Bus transport, private scholars, and personalized concierge services.",
  },
  {
    template: "Hajj Early Registration",
    category: "Early Registration",
    best: "Advance queueing for Hajj",
    content: "Reserve your spot early for the upcoming Hajj season. Secure your priority placement while ministry quotas, flight schedules, and hotel allocations are finalized.",
  },
  {
    template: "Hajj Waitlist",
    category: "Early Registration",
    best: "Backup queue",
    content: "Join the official waitlist for Hajj quota allocations. In case of cancellations or additional quota releases, waitlisted pilgrims will be processed first.",
  },
  {
    template: "Guided Pilgrimage",
    category: "Umrah",
    best: "First-time pilgrims",
    content: "An intensive guided Umrah journey led by senior scholars with step-by-step Tawaaf, Sa'i, and historical Ziyarah guidance.",
  },
  {
    template: "Ziyarah Included",
    category: "Umrah",
    best: "Comprehensive sightseeing",
    content: "An extended Umrah package including full historical Ziyarah in Makkah (Jabal Al-Noor, Jabal Thawr, Mina) and Madinah (Quba, Uhud, Qiblatain, Badar).",
  },
  {
    template: "Custom / TBC Services",
    category: "Early Registration",
    best: "Bespoke packages",
    content: "A customizable package framework where final hotel standards, flights, and dates can be tailored to group requirements upon confirmation.",
  },
];

export const PACKAGE_CATEGORY: PackageCategory[] = [
  "Economy",
  "Standard",
  "Premium",
  "VIP",
  "Custom",
];

export const DEFAULT_PAYMENT_MILESTONES: Record<string, PaymentMilestone[]> = {
  Umrah: [
    {
      id: "pm-1",
      label: "Booking Deposit",
      amountType: "Fixed Amount",
      amount: 100000,
      dueRule: "On Booking",
      refundable: true,
      notes: "Required upon booking confirmation to hold seat.",
    },
    {
      id: "pm-2",
      label: "Final Balance",
      amountType: "Remaining Balance",
      amount: "",
      dueRule: "Days Before Departure",
      daysBeforeDeparture: 14,
      refundable: false,
      notes: "Must be settled prior to visa issuance.",
    },
  ],
  Hajj: [
    {
      id: "pm-h1",
      label: "Initial Registration Deposit",
      amountType: "Fixed Amount",
      amount: 250000,
      dueRule: "On Booking",
      refundable: true,
      notes: "Initial deposit for ministry portal registration.",
    },
    {
      id: "pm-h2",
      label: "First Instalment (Ministry Quota)",
      amountType: "Percentage",
      amount: 40,
      dueRule: "Days Before Departure",
      daysBeforeDeparture: 60,
      refundable: false,
      notes: "Due upon official ministry quota allocation.",
    },
    {
      id: "pm-h3",
      label: "Final Balance",
      amountType: "Remaining Balance",
      amount: "",
      dueRule: "Days Before Departure",
      daysBeforeDeparture: 21,
      refundable: false,
      notes: "Final settlement before visa stamping and flight ticketing.",
    },
  ],
};

export const DEFAULT_TRANSPORT_REQUIREMENTS: TransportRequirement[] = [
  {
    id: "tr-1",
    routeLabel: "Airport Arrival Transfer",
    startLocation: "Jeddah / Madinah Airport",
    destination: "Makkah Hotel",
    required: true,
    vehicleStandard: "Bus",
    vehicleNotes: "Air-conditioned VIP Bus with luggage compartment",
    state: "Included",
    internalNotes: "Standard arrival transfer for full group",
  },
  {
    id: "tr-2",
    routeLabel: "Intercity Transfer",
    startLocation: "Makkah Hotel",
    destination: "Madinah Hotel",
    required: true,
    vehicleStandard: "Bus",
    vehicleNotes: "Comfortable intercity AC bus / Haramain Train option",
    state: "Included",
    internalNotes: "4-hour highway journey with comfort stop",
  },
  {
    id: "tr-3",
    routeLabel: "Departure Transfer",
    startLocation: "Madinah Hotel",
    destination: "Jeddah / Madinah Airport",
    required: true,
    vehicleStandard: "Bus",
    vehicleNotes: "Direct transfer 4 hours before flight departure",
    state: "Included",
    internalNotes: "Ensure luggage load 5 hours before flight",
  },
  {
    id: "tr-4",
    routeLabel: "Ziyarah Local Transport",
    startLocation: "Hotel Base",
    destination: "Historical Sites (Makkah & Madinah)",
    required: true,
    vehicleStandard: "Bus",
    vehicleNotes: "Guided tour transport with Mutawwif onboard",
    state: "Included",
    internalNotes: "Includes Jabal Al-Noor, Quba, Uhud visits",
  },
];

export const DEFAULT_DOCUMENT_REQUIREMENTS: DocumentRequirement[] = [
  {
    id: "doc-1",
    name: "Passport Copy (Clear Bio-page Scan)",
    category: "Passport",
    required: true,
    requiredByStage: "On Booking",
    verifiedByRole: "Operations",
    visibleInPortal: true,
  },
  {
    id: "doc-2",
    name: "Passport Validity Check (Minimum 6 Months)",
    category: "Passport",
    required: true,
    requiredByStage: "Before Visa Submission",
    verifiedByRole: "Visa",
    visibleInPortal: true,
  },
  {
    id: "doc-3",
    name: "White Background Passport Photo (4x6 cm)",
    category: "Identity",
    required: true,
    requiredByStage: "Before Visa Submission",
    verifiedByRole: "Visa",
    visibleInPortal: true,
  },
  {
    id: "doc-4",
    name: "Meningitis & Vaccination Certificate",
    category: "Medical",
    required: true,
    requiredByStage: "Before Visa Submission",
    verifiedByRole: "Operations",
    visibleInPortal: true,
  },
  {
    id: "doc-5",
    name: "National Identity Card / NIC Copy",
    category: "Identity",
    required: true,
    requiredByStage: "On Booking",
    verifiedByRole: "Admin",
    visibleInPortal: true,
  },
  {
    id: "doc-6",
    name: "Travel & Medical Insurance Confirmation",
    category: "Travel",
    required: true,
    requiredByStage: "Before Departure",
    verifiedByRole: "Operations",
    visibleInPortal: true,
  },
  {
    id: "doc-7",
    name: "Emergency Contact & Next of Kin Form",
    category: "Other",
    required: true,
    requiredByStage: "On Booking",
    verifiedByRole: "Admin",
    visibleInPortal: true,
  },
  {
    id: "doc-8",
    name: "Initial Booking Deposit Threshold Met",
    category: "Finance",
    required: true,
    requiredByStage: "On Booking",
    verifiedByRole: "Finance",
    visibleInPortal: true,
  },
];

export const DEFAULT_READINESS_CHECKLIST: GroupReadinessRequirement[] = [
  { id: "gr-1", label: "Departure Date & Flight Route Confirmed", required: true, responsibleRole: "Operations", dueTiming: "Before Booking" },
  { id: "gr-2", label: "Flight Seats Held / Ticket PNR Active", required: true, responsibleRole: "Operations", dueTiming: "Before Visa Submission" },
  { id: "gr-3", label: "Makkah Hotel Booking Confirmed", required: true, responsibleRole: "Operations", dueTiming: "Before Booking" },
  { id: "gr-4", label: "Madinah Hotel Booking Confirmed", required: true, responsibleRole: "Operations", dueTiming: "Before Booking" },
  { id: "gr-5", label: "Airport Arrival Transport Confirmed", required: true, responsibleRole: "Operations", dueTiming: "7 days before departure" },
  { id: "gr-6", label: "Intercity Transport Contracted", required: true, responsibleRole: "Operations", dueTiming: "7 days before departure" },
  { id: "gr-7", label: "Airport Departure Transport Confirmed", required: true, responsibleRole: "Operations", dueTiming: "7 days before departure" },
  { id: "gr-8", label: "Catering / Buffet Services Confirmed", required: true, responsibleRole: "Operations", dueTiming: "14 days before departure" },
  { id: "gr-9", label: "Mutawwif / Religious Guide Assigned", required: true, responsibleRole: "Guide", dueTiming: "14 days before departure" },
  { id: "gr-10", label: "Pilgrim Payment Threshold Verified (100%)", required: true, responsibleRole: "Finance", dueTiming: "14 days before departure" },
  { id: "gr-11", label: "All Pilgrim Passport & Docs Verified", required: true, responsibleRole: "Visa", dueTiming: "21 days before departure" },
  { id: "gr-12", label: "Saudi E-Visa Stamped & Issued", required: true, responsibleRole: "Visa", dueTiming: "7 days before departure" },
  { id: "gr-13", label: "Final Rooming List Allocations Done", required: true, responsibleRole: "Operations", dueTiming: "5 days before departure" },
  { id: "gr-14", label: "Pilgrim Flight Manifest Finalised", required: true, responsibleRole: "Operations", dueTiming: "3 days before departure" },
];

export const INITIAL_PACKAGE_FORM_DATA: PackageFormData = {
  // Step 1: Commercial Identity
  title: "14-Day Standard Umrah Package 2026",
  internalCode: "RF-PKG-2026-UM01",
  description: "A comprehensive guided Umrah journey featuring 4-star hotel accommodations in Makkah and Madinah, direct air tickets, intercity VIP bus transfers, guided historical Ziyarah tours, and full Mutawwif support.",
  journeyType: "Umrah",
  category: "Umrah",
  // Unused by every step's UI (the mapper always refills it from this default
  // on read — see `mappers.ts`), so it stays a fixed string rather than
  // calling `new Date()` at module scope: this file's module-level constant
  // is evaluated once during the server render and again during client
  // hydration, and those two evaluations are not guaranteed to see the same
  // wall-clock moment (or timezone).
  year: "",
  package_category: "Standard",
  branch: "All Branches",
  visibility: "Pilgrim Portal",
  status: "Draft",
  featured: false,
  defaultCapacity: 40,
  minGroupSize: 15,
  waitlistEnabled: true,
  seatHoldExpiry: "24 hours",
  suggestedGuideRatio: 40,
  maxPilgrims: 40,
  days: 11,
  nights: 10,
  duration: "11 Days / 10 Nights",

  // Step 2: Pricing policy (the actual prices are collected per Departure Group)
  paymentMilestones: DEFAULT_PAYMENT_MILESTONES.Umrah,
  paymentTerms: "50% advance upon booking confirmation, balance 14 days prior to departure.",
  cancellationPolicy: "Full refund 30+ days prior to departure. 50% refund 15-29 days prior.",
  latePaymentPolicy: "Bookings with unpaid balances 10 days prior to departure are subject to auto-cancellation.",
  priceChangeDisclaimer: "Prices are subject to flight availability and ministry visa fee adjustments.",
  financeRoleView: "Admin",

  itinerary: [
    {
      id: "it-1",
      dayNumber: 1,
      title: "Departure from Colombo & Arrival in Makkah",
      location: "Colombo / Jeddah / Makkah",
      category: "Arrival",
      description: "Flight from Colombo to Jeddah. Transfer by VIP bus to hotel in Makkah, hotel check-in and orientation.",
      internalNotes: "Ensure Mutawwif meets group at Jeddah Hajj Terminal",
    },
    {
      id: "it-2",
      dayNumber: 2,
      title: "Perform First Umrah Rituals",
      location: "Masjid al-Haram, Makkah",
      category: "Ritual",
      description: "Guided performance of Tawaaf and Sa'i accompanied by experienced Mutawwif guide.",
      internalNotes: "Gather at hotel lobby 2 hours after Isha",
    },
    {
      id: "it-3",
      dayNumber: 3,
      title: "Makkah Historical Ziyarah",
      location: "Makkah Al-Mukarramah",
      category: "Ziyarah",
      description: "Guided tour to Jabal Al-Noor (Cave Hira), Jabal Thawr, Mina, Arafat, and Muzdalifah.",
      internalNotes: "AC bus departure at 07:00 AM from hotel",
    },
  ],

  // Step 4: Service Standards
  includedServices: [
    "Return air ticket",
    "Visa support / processing",
    "Travel / medical insurance",
    "Makkah accommodation",
    "Madinah accommodation",
    "Airport transfer",
    "Makkah ↔ Madinah intercity transport",
    "Local / ziyarah transport",
    "Meals / catering",
    "Guided ziyarah tours",
    "Religious guide / Mutawwif support",
    "Zamzam allocation",
    "Welcome kit / Ihram kit",
  ],
  makkahAccommodationStandard: "4-star",
  makkahCustomerWording: "4-star accommodation near Masjid al-Haram (within 350m) or similar",
  makkahNights: 6,
  makkahOccupancies: ["Quad", "Triple", "Double", "Single"],
  makkahTargetDistance: "Within 500m",
  makkahMealPlan: "Full Board",
  makkahExactHotelGuarantee: false,
  makkahHotel: "Pullman Zamzam Makkah",
  makkahExactDisplayName: "Pullman Zamzam Makkah (Guaranteed)",
  madinahAccommodationStandard: "4-star",
  madinahCustomerWording: "4-star accommodation near Prophet's Mosque (within 200m) or similar",
  madinahNights: 4,
  madinahOccupancies: ["Quad", "Triple", "Double", "Single"],
  madinahTargetDistance: "Within 250m",
  madinahMealPlan: "Full Board",
  madinahExactHotelGuarantee: false,
  madinahHotel: "Frontel Al Harithia",
  madinahExactDisplayName: "Frontel Al Harithia (Guaranteed)",
  transportType: "Air-Conditioned VIP Bus",
  transportRequirements: DEFAULT_TRANSPORT_REQUIREMENTS,
  inclusions: [
    "Visa Processing & Support",
    "Return Air Ticket (Colombo ↔ Jeddah/Madinah)",
    "Hotel Accommodation in Makkah & Madinah",
    "Buffet Meals (Full Board)",
    "Guided Ziyarah Tours in Makkah & Madinah",
    "Air-conditioned VIP Bus Transport",
    "5L Zamzam Water Allocation",
    "Experienced Mutawwif / Guide",
    "Ihram & Travel Welcome Kit",
    "Travel / Medical Insurance, if included",
  ],
  customInclusionInput: "",
  exclusions: [
    "Personal & Shopping Expenses",
    "Excess Baggage Charges",
    "Personal Room Service & Laundry",
    "Optional Private Transport",
  ],
  customExclusionInput: "",

  // Step 5: Traveller Requirements
  documentRequirements: DEFAULT_DOCUMENT_REQUIREMENTS,
  seatReservationRule: "Deposit must be received before a group seat is reserved",
  selectedCommunicationTemplates: [
    "On Booking Confirmation",
    "Missing Document Reminder",
    "Payment Due Reminder",
    "7-Day Pre-Departure Briefing",
  ],

  // Step 6: Group Creation Defaults
  defaultGroupCapacity: 40,
  defaultGroupStatus: "Planning",
  groupReadinessChecklist: DEFAULT_READINESS_CHECKLIST,

  // Metadata / Legacy
  startDate: "",
  endDate: "",
  guide: "M.S.M Shafaath",
};
