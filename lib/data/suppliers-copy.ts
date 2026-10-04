/**
 * Every label, threshold and taxonomy the Supplier Directory uses, in one
 * file — same convention as `operations-copy.ts` / `visa-copy.ts`. Nothing
 * else in the module hardcodes one of these values.
 */

export const PAYMENT_DUE_WINDOW_DAYS = 14;
export const PAYMENT_SOON_WINDOW_DAYS = 7;
export const CONFIRMATION_FOLLOW_UP_DAYS = 3;
export const OVERVIEW_LIST_CAP = 6;
export const MAX_AI_SUGGESTIONS = 5;

export const SUPPLIER_TYPE_LABELS: Record<string, string> = {
  BROKER: "Broker / Ground Handler",
  HOTEL: "Hotel / Accommodation",
  TRANSPORT: "Transport Provider",
  CATERING: "Catering Provider",
  TICKETING: "Airline / Ticketing Agent",
  VISA_PARTNER: "Visa / Travel Service Partner",
  INSURANCE: "Insurance Provider",
  GUIDE_PARTNER: "Guide / Mutawwif Partner",
  ZIYARAH: "Ziyarah / Tour Provider",
  ANCILLARY: "Laundry / SIM / Welcome Kit Provider",
  OTHER: "Other",
};

export const SERVICE_CATEGORY_LABELS: Record<string, string> = {
  MAKKAH_ACCOMMODATION: "Makkah Accommodation",
  MADINAH_ACCOMMODATION: "Madinah Accommodation",
  ACCOMMODATION_OTHER: "Other Accommodation",
  AIRPORT_TRANSFER: "Airport Transfer",
  INTERCITY_TRANSPORT: "Intercity Transport",
  ZIYARAH_TRANSPORT: "Ziyarah Transport",
  CATERING: "Catering",
  TICKETING: "Ticketing",
  VISA_SERVICE: "Visa Service",
  INSURANCE: "Insurance",
  GUIDE_SERVICE: "Guide Service",
  ANCILLARY: "Ancillary",
  OTHER: "Other",
};

export const COMMITMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  REQUESTED: "Requested",
  SUPPLIER_RESPONDED: "Supplier Responded",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  DISPUTED: "Disputed",
};

export const RELIABILITY_LABELS: Record<string, string> = {
  RELIABLE: "Reliable",
  NEEDS_ATTENTION: "Needs Attention",
  ON_HOLD: "On Hold",
  INACTIVE: "Inactive",
};

export const PAYMENT_TERMS_LABELS: Record<string, string> = {
  DEPOSIT_REQUIRED: "Deposit Required",
  PAY_AFTER_CONFIRMATION: "Pay After Confirmation",
  CUSTOM: "Custom",
};

export const PREFERRED_CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  PHONE: "Phone",
  EMAIL: "Email",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: "Unpaid",
  PARTIAL: "Partial",
  PAID: "Paid",
  OVERDUE: "Overdue",
};


export const CURRENCY_LABELS: Record<string, string> = {
  SAR: "SAR",
  LKR: "LKR",
  USD: "USD",
  AED: "AED",
  OTHER: "Other",
};
export const CURRENT_CURRENCY = CURRENCY_LABELS["LKR"];

export const SEASON_LABELS: Record<string, string> = {
  STANDARD: "Standard Umrah",
  RAMADAN: "Ramadan",
  HAJJ: "Hajj",
  PEAK: "Peak",
  OTHER: "Other",
};
