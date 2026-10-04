/**
 * Every label, threshold and taxonomy the Reports module renders. Nothing
 * else in `app/(main)/reports/` or `lib/data/reports.ts` hardcodes one of
 * these — same convention as `lib/data/finance-copy.ts`.
 */

/** The Executive Summary's "Target: 90%" caption. No target exists in the
 * database yet (mirrors Finance plan F9's `COLLECTION_TARGET_SOURCE` gap). */
export const COLLECTION_RATE_TARGET_PERCENT = 90;

/** The Executive Summary's "Below 20% target" caption. */
export const GROSS_MARGIN_TARGET_PERCENT = 20;

/** A group counts as "at risk" for the Average Group Readiness card. */
export const AT_RISK_READINESS_STATUSES = ["AT_RISK", "BLOCKED"] as const;

/** Most Hajj/Umrah visa authorities require six months' passport validity
 * from the travel date — the Passport Validity Risk report's threshold. */
export const PASSPORT_VALIDITY_THRESHOLD_DAYS = 180;

export const VISA_STATUS_GROUP_LABELS = {
  NOT_STARTED: "Not Started",
  READY_TO_SUBMIT: "Ready to Submit",
  SUBMITTED: "Submitted",
  ISSUED: "Issued",
  REWORK: "Rework",
  REJECTED: "Rejected",
} as const;

/** Receivables Aging buckets, in days overdue. */
export const AGING_BUCKETS = [
  { key: "NOT_DUE", label: "Not Due", minDays: -Infinity, maxDays: 0 },
  { key: "DUE_1_7", label: "1–7 Days Overdue", minDays: 1, maxDays: 7 },
  { key: "DUE_8_30", label: "8–30 Days Overdue", minDays: 8, maxDays: 30 },
  { key: "DUE_31_PLUS", label: "31+ Days Overdue", minDays: 31, maxDays: Infinity },
] as const;

/**
 * Stage labels for reports come from `LEAD_STAGE_LABELS`
 * (`lib/types/leads.ts`) rather than a second copy here — this file and the
 * Leads module used to keep separate maps that disagreed (e.g. "New Leads"
 * vs "New Lead") for the same stage.
 */

/** The funnel report's stage order — current-state counts only (plan §D). */
export const LEAD_FUNNEL_STAGES = [
  "NEW_LEAD",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL_SENT",
  "DEPOSIT_PENDING",
  "BOOKED",
] as const;

export const LEAD_SOURCE_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  PHONE_CALL: "Phone",
  WALK_IN: "Walk-in",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  WEBSITE: "Website",
  GOOGLE: "Google",
  REFERRAL: "Referral",
  REPEAT_CUSTOMER: "Repeat Customer",
  COMMUNITY_EVENT: "Mosque Event",
  OTHER: "Other",
};

export const LOST_REASON_LABELS: Record<string, string> = {
  PRICE_TOO_HIGH: "Price too high",
  DATE_UNAVAILABLE: "Preferred date unavailable",
  NO_SEATS: "No seats available",
  COMPETITOR: "Competitor chosen",
  VISA_CONCERN: "Visa concern",
  NO_RESPONSE: "No response",
  POSTPONED_TRAVEL: "Postponed",
  PAYMENT_ISSUE: "Payment / instalment issue",
  DUPLICATE: "Duplicate",
  OTHER: "Other",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank Transfer",
  CARD: "Card",
  ONLINE: "Online",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

export const MILESTONE_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: "Deposit",
  INSTALMENT: "Instalment",
  FINAL_BALANCE: "Final Balance",
  ADJUSTMENT: "Adjustment",
  OTHER: "Other",
};

export const TASK_CATEGORY_LABELS: Record<string, string> = {
  OPERATIONS: "Operations",
  VISA: "Visa",
  FINANCE: "Finance",
  GUIDE: "Guide",
  MARKETING: "Marketing",
  OTHER: "Other",
};

/** Static branch list — same set surfaced today in `admin-header-filters.tsx`.
 * Repointed to a distinct-branches query once a branches table exists. */
export const BRANCH_OPTIONS = ["Colombo Branch", "Kandy Branch", "Galle Branch"] as const;

/** Custom Report Builder — the fixed metric/group-by/format vocabulary the
 * plan defines for V1 (no drag-and-drop BI tool). */
export const CUSTOM_REPORT_TYPES = ["SALES", "FINANCE", "GROUPS", "PILGRIMS", "SUPPLIERS"] as const;

export const CUSTOM_REPORT_METRICS = [
  "BOOKINGS",
  "REVENUE",
  "COLLECTION_RATE",
  "VISA_ISSUED_COUNT",
  "GROUP_READINESS",
  "SUPPLIER_PAYMENT_AMOUNT",
] as const;

export const CUSTOM_REPORT_GROUP_BY = ["MONTH", "PACKAGE", "DEPARTURE_GROUP", "BRANCH", "SALES_OWNER", "SOURCE"] as const;

export const CUSTOM_REPORT_FORMATS = ["TABLE", "BAR_CHART", "LINE_CHART", "SUMMARY_CARDS"] as const;
