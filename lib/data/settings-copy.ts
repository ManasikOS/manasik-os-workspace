/**
 * Every label, option list, taxonomy and default the Settings module uses, in
 * one file — same convention as `operations-copy.ts` / `finance-copy.ts` /
 * `team-copy.ts`. Nothing under `app/(main)/management/settings/` hardcodes
 * one of these.
 */

import type { StaffRole } from "@/lib/access/departure-groups-access";
import type {
  AccessRestrictionFlags,
  BranchRules,
  CriticalFlags,
  IntegrationProvider,
  PortalFlags,
  TemplateAudience,
  TemplateCategory,
  TemplateChannel,
} from "@/lib/types/settings";

/* ── §5.1 Organisation ────────────────────────────────────────────────────── */

export const COUNTRY_OPTIONS = [
  { value: "LK", label: "Sri Lanka" },
  { value: "SA", label: "Saudi Arabia" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "IN", label: "India" },
  { value: "GB", label: "United Kingdom" },
  { value: "IE", label: "Ireland" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "NL", label: "Netherlands" },
  { value: "TR", label: "Turkey" },
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { value: "AU", label: "Australia" },
  { value: "ZA", label: "South Africa" },
  { value: "NG", label: "Nigeria" },
  { value: "EG", label: "Egypt" },
  { value: "QA", label: "Qatar" },
  { value: "KW", label: "Kuwait" },
  { value: "OM", label: "Oman" },
  { value: "BH", label: "Bahrain" },
  { value: "PK", label: "Pakistan" },
  { value: "BD", label: "Bangladesh" },
  { value: "MV", label: "Maldives" },
  { value: "MY", label: "Malaysia" },
  { value: "SG", label: "Singapore" },
  { value: "ID", label: "Indonesia" },
  { value: "OTHER", label: "Other" },
];

export const CURRENCY_OPTIONS = [
  { value: "LKR", label: "LKR — Sri Lankan Rupee" },
  { value: "SAR", label: "SAR — Saudi Riyal" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "TRY", label: "TRY — Turkish Lira" },
  { value: "CAD", label: "CAD — Canadian Dollar" },
  { value: "AUD", label: "AUD — Australian Dollar" },
  { value: "ZAR", label: "ZAR — South African Rand" },
  { value: "NGN", label: "NGN — Nigerian Naira" },
  { value: "EGP", label: "EGP — Egyptian Pound" },
  { value: "QAR", label: "QAR — Qatari Riyal" },
  { value: "KWD", label: "KWD — Kuwaiti Dinar" },
  { value: "OMR", label: "OMR — Omani Rial" },
  { value: "BHD", label: "BHD — Bahraini Dinar" },
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "PKR", label: "PKR — Pakistani Rupee" },
  { value: "BDT", label: "BDT — Bangladeshi Taka" },
  { value: "MVR", label: "MVR — Maldivian Rufiyaa" },
  { value: "MYR", label: "MYR — Malaysian Ringgit" },
  { value: "SGD", label: "SGD — Singapore Dollar" },
  { value: "IDR", label: "IDR — Indonesian Rupiah" },
  { value: "OTHER", label: "Other" },
];

export const TIMEZONE_OPTIONS = [
  { value: "Asia/Colombo", label: "Asia/Colombo (Sri Lanka)" },
  { value: "Asia/Riyadh", label: "Asia/Riyadh (Saudi Arabia)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (UAE)" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (India)" },
  { value: "Europe/London", label: "Europe/London (United Kingdom)" },
  { value: "Europe/Dublin", label: "Europe/Dublin (Ireland)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (Germany)" },
  { value: "Europe/Paris", label: "Europe/Paris (France)" },
  { value: "Europe/Amsterdam", label: "Europe/Amsterdam (Netherlands)" },
  { value: "Europe/Istanbul", label: "Europe/Istanbul (Turkey)" },
  { value: "America/New_York", label: "America/New_York (US Eastern)" },
  { value: "America/Toronto", label: "America/Toronto (Canada Eastern)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (Australia)" },
  { value: "Africa/Johannesburg", label: "Africa/Johannesburg (South Africa)" },
  { value: "Africa/Lagos", label: "Africa/Lagos (Nigeria)" },
  { value: "Africa/Cairo", label: "Africa/Cairo (Egypt)" },
  { value: "Asia/Qatar", label: "Asia/Qatar (Qatar)" },
  { value: "Asia/Kuwait", label: "Asia/Kuwait (Kuwait)" },
  { value: "Asia/Muscat", label: "Asia/Muscat (Oman)" },
  { value: "Asia/Bahrain", label: "Asia/Bahrain (Bahrain)" },
  { value: "Asia/Karachi", label: "Asia/Karachi (Pakistan)" },
  { value: "Asia/Dhaka", label: "Asia/Dhaka (Bangladesh)" },
  { value: "Indian/Maldives", label: "Indian/Maldives (Maldives)" },
  { value: "Asia/Kuala_Lumpur", label: "Asia/Kuala_Lumpur (Malaysia)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (Singapore)" },
  { value: "Asia/Jakarta", label: "Asia/Jakarta (Indonesia)" },
  { value: "UTC", label: "UTC (no daylight saving)" },
];

export const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "si", label: "Sinhala" },
  { value: "ta", label: "Tamil" },
  { value: "ar", label: "Arabic" },
];

/* ── §5.2 Branches ────────────────────────────────────────────────────────── */

export const BRANCH_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

export const DEFAULT_BRANCH_RULES: BranchRules = {
  restrictStaffToAssignedBranch: true,
  allowAdminViewAllBranches: true,
  allowCeoViewAllBranches: true,
  allowCrossBranchBookingManagement: false,
};

/* ── §5.3 Branding & Pilgrim Portal ───────────────────────────────────────── */

export const PORTAL_FLAG_LABELS: Record<keyof PortalFlags, string> = {
  allowDocumentUploads: "Allow pilgrim document uploads",
  allowViewPaymentSchedule: "Allow pilgrims to view payment schedule",
  allowUploadPaymentProof: "Allow pilgrims to upload payment proof",
  showItineraryAfterConfirmation: "Show travel itinerary after confirmation",
  showHotelDetailsAfterConfirmation: "Show hotel details only after confirmation",
  showGuideContact7DaysBefore: "Show guide contact 7 days before departure",
  allowSupportRequests: "Allow support requests",
};

export const DEFAULT_PORTAL_FLAGS: PortalFlags = {
  allowDocumentUploads: true,
  allowViewPaymentSchedule: true,
  allowUploadPaymentProof: true,
  showItineraryAfterConfirmation: true,
  showHotelDetailsAfterConfirmation: true,
  showGuideContact7DaysBefore: true,
  allowSupportRequests: true,
};

/**
 * The spec's "Do not expose" list for the pilgrim portal. Not a UI toggle —
 * a documented contract the future portal's serialiser must assert against.
 * See the Settings plan §5.3 / F5.
 */
export const PORTAL_FORBIDDEN_FIELDS = [
  "Internal supplier details",
  "Margin / cost",
  "Other pilgrims' details",
  "Internal notes",
  "Group readiness score",
  "Staff task information",
] as const;

/* ── §5.4 Operational Defaults ────────────────────────────────────────────── */

export const GROUP_STATUS_OPTIONS = [
  { value: "PLANNING", label: "Planning" },
  { value: "PREPARING", label: "Preparing" },
  { value: "READY_TO_DEPART", label: "Ready to Depart" },
];

export const SALES_STATUS_OPTIONS = [
  { value: "SELLING", label: "Selling" },
  { value: "WAITLIST_ONLY", label: "Waitlist Only" },
  { value: "CLOSED", label: "Closed" },
];

export const PASSPORT_PHOTO_REQUIREMENT_OPTIONS = [
  { value: "WHITE_BACKGROUND", label: "White background" },
  { value: "BLUE_BACKGROUND", label: "Blue background" },
  { value: "ANY_BACKGROUND", label: "Any background" },
];

export const CRITICAL_FLAG_LABELS: Record<keyof CriticalFlags, string> = {
  missingFlightsIsCritical: "Treat missing flights as critical",
  missingHotelConfirmationIsCritical: "Treat missing hotel confirmation as critical",
  pendingVisaWithin7DaysIsCritical: "Treat pending visas within 7 days as critical",
  overduePaymentsIsHighPriority: "Treat overdue payments as high priority",
};

export const DEFAULT_CRITICAL_FLAGS: CriticalFlags = {
  missingFlightsIsCritical: true,
  missingHotelConfirmationIsCritical: true,
  pendingVisaWithin7DaysIsCritical: true,
  overduePaymentsIsHighPriority: true,
};

export type ReadinessBand = "READY" | "AT_RISK" | "BLOCKED";

export const READINESS_BAND_LABELS: Record<ReadinessBand, string> = {
  READY: "Ready",
  AT_RISK: "At Risk",
  BLOCKED: "Blocked",
};

/* ── §5.5 Communication Templates ─────────────────────────────────────────── */

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  LEAD_RECEIVED: "Lead received",
  FIRST_FOLLOW_UP: "First follow-up",
  PACKAGE_QUOTATION: "Package quotation",
  BOOKING_CONFIRMATION: "Booking confirmation",
  DEPOSIT_REMINDER: "Deposit reminder",
  PAYMENT_DUE_REMINDER: "Payment due reminder",
  MISSING_DOCUMENT_REMINDER: "Missing document reminder",
  DOCUMENT_REWORK_REQUEST: "Document rework request",
  VISA_STATUS_UPDATE: "Visa status update",
  VISA_APPROVED: "Visa approved",
  PRE_DEPARTURE_BRIEFING: "Pre-departure briefing",
  GUIDE_CONTACT_MESSAGE: "Guide contact message",
  DEPARTURE_REMINDER: "Departure reminder",
  POST_TRIP_FEEDBACK_REQUEST: "Post-trip feedback request",
  REFUND_UPDATE: "Refund update",
};

export const TEMPLATE_CHANNEL_LABELS: Record<TemplateChannel, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  PORTAL: "Portal",
  SMS: "SMS",
};

export const TEMPLATE_AUDIENCE_LABELS: Record<TemplateAudience, string> = {
  LEAD: "Lead",
  BOOKING_CONTACT: "Booking Contact",
  PILGRIM: "Pilgrim",
  GROUP: "Group",
  STAFF: "Staff",
};

/**
 * The full variable vocabulary a template body may use. Code, not data — an
 * unknown `{{token}}` is a save-time validation error, never a silently
 * broken outbound message. See the Settings plan §5.5 / D7.
 */
export const TEMPLATE_VARIABLES = [
  "customer_name",
  "pilgrim_name",
  "booking_reference",
  "departure_group_name",
  "departure_date",
  "payment_due_amount",
  "payment_due_date",
  "payment_amount",
  "guide_name",
  "portal_link",
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/** Fills every variable with a plausible value, for `[Preview with sample data]`. */
export const SAMPLE_TEMPLATE_CONTEXT: Record<TemplateVariable, string> = {
  customer_name: "Ahmed Fazil",
  pilgrim_name: "Ahmed Fazil",
  booking_reference: "BKG-2026-00042",
  departure_group_name: "Umrah — March Batch 2",
  departure_date: "12 Mar 2026",
  payment_due_amount: "LKR 85,000",
  payment_due_date: "20 Feb 2026",
  payment_amount: "LKR 85,000",
  guide_name: "M. Rameez",
  portal_link: "https://portal.example.com/booking/BKG-2026-00042",
};

/** Extracts every `{{token}}` in a template body, for save-time validation. */
export function extractTemplateTokens(body: string): string[] {
  const matches = body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

/** Renders a template body against the sample context — client-safe, no I/O. */
export function renderTemplatePreview(body: string): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, token: string) => {
    return (SAMPLE_TEMPLATE_CONTEXT as Record<string, string>)[token] ?? match;
  });
}

/* ── §5.6 Finance Defaults ────────────────────────────────────────────────── */

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank Transfer",
  CARD: "Card",
  ONLINE: "Online Payment",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

export const REFERENCE_PREFIX_FIELDS = [
  { key: "invoicePrefix", label: "Invoice Number Prefix", example: "INV-2026-00001" },
  { key: "receiptPrefix", label: "Receipt Number Prefix", example: "RCT-2026-00001" },
  { key: "paymentPrefix", label: "Payment Number Prefix", example: "PAY-2026-00001" },
  { key: "supplierBillPrefix", label: "Supplier Bill Prefix", example: "SUP-2026-00001" },
] as const;

/** Which roles' `viewCosts` a settings toggle is even allowed to touch — see D4. */
export const MARGIN_VISIBILITY_ELIGIBLE_ROLES: StaffRole[] = ["ADMIN", "CEO", "FINANCE"];

/* ── §5.7 Integrations ────────────────────────────────────────────────────── */

export const INTEGRATION_LABELS: Record<IntegrationProvider, string> = {
  WHATSAPP_BUSINESS: "WhatsApp Business",
  EMAIL: "Email Provider",
  SMS: "SMS Provider",
  PAYMENT_GATEWAY: "Payment Gateway",
  FILE_STORAGE: "Google Drive / File Storage",
  ACCOUNTING: "Accounting Software",
  NUSUK: "Nusuk / Official Visa Workflow",
};

export const INTEGRATION_STATUS_LABELS: Record<string, string> = {
  NOT_CONNECTED: "Not Connected",
  CONNECTED: "Connected",
  MANUAL_WORKFLOW: "Manual Workflow",
  ERROR: "Needs Attention",
  DISCONNECTED: "Disconnected",
};

/* ── §5.8 Security & Access ───────────────────────────────────────────────── */

export const ACCESS_RESTRICTION_FLAG_LABELS: Record<keyof AccessRestrictionFlags, string> = {
  restrictGuidesToAssignedGroups: "Restrict Guides to assigned Departure Groups",
  restrictMarketingFromPassportVisaData: "Restrict Marketing from passport / visa data",
  restrictGuidesFromFinanceData: "Restrict Guides from finance data",
  restrictFinanceFromMedicalRecords: "Restrict Finance from medical records",
};

export const DEFAULT_ACCESS_RESTRICTION_FLAGS: AccessRestrictionFlags = {
  restrictGuidesToAssignedGroups: true,
  restrictMarketingFromPassportVisaData: true,
  restrictGuidesFromFinanceData: true,
  restrictFinanceFromMedicalRecords: true,
};

/** Fields whose enforcement is outside the app — see the Settings plan F6 / D15. */
export const ACCOUNT_SECURITY_UNAVAILABLE_REASON =
  "Configured in the Supabase Auth project settings, not this application. Ask whoever administers the Supabase project to change this.";

/* ── §5.9 Data & Audit ────────────────────────────────────────────────────── */

export const RETENTION_PERIOD_OPTIONS = [
  { value: 1, label: "1 year" },
  { value: 3, label: "3 years" },
  { value: 5, label: "5 years" },
  { value: 7, label: "7 years" },
  { value: 10, label: "10 years" },
];

export const EXPORT_ENTITY_LABELS: Record<string, string> = {
  PILGRIMS: "Pilgrims",
  BOOKINGS: "Bookings",
  PAYMENTS: "Payments",
  INVOICES: "Invoices",
  REPORTS: "Reports",
  AUDIT_LOG: "Audit Log",
};

export const IMPORT_ENTITY_LABELS: Record<string, string> = {
  LEADS: "Leads CSV",
  PILGRIMS: "Pilgrims CSV",
  PACKAGES: "Packages CSV",
  SUPPLIERS: "Supplier CSV",
};

export const AUDIT_SOURCE_LABELS: Record<string, string> = {
  GROUP: "Departure Group",
  PILGRIM: "Pilgrim",
  STAFF: "Team",
  SETTINGS: "Settings",
};
