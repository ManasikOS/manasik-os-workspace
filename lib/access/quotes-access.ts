/**
 * Role-based access for the Quotes module — registered as a placeholder in
 * Phase 0 (P0.3); real capabilities assigned here in Phase 1 (P1.4) of
 * docs/modules/manasik-intelligence-build-roadmap.md, once `/quotes/[quoteId]`
 * actually exists to gate. Mirrors the quote-related fields
 * `lib/access/leads-access.ts` already had for each role (`sendQuote`,
 * `viewQuotes`, `convertToBooking`, `createQuoteDraft`) — this module
 * replaces that page-level gate, `leads-access.ts` keeps its own fields
 * for whatever leads-surface UI still reads them.
 */

import type { StaffRole } from "@/lib/access/departure-groups-access";

export interface QuotesCapabilities {
  viewModule: boolean;
  createQuote: boolean;
  editQuote: boolean;
  sendQuote: boolean;
  applyDiscount: boolean;
  applyUnrestrictedDiscount: boolean;
  approveDiscount: boolean;
  acceptOnBehalf: boolean;
  rejectQuote: boolean;
  convertToBooking: boolean;
  viewMargin: boolean;
}

const NONE: QuotesCapabilities = {
  viewModule: false,
  createQuote: false,
  editQuote: false,
  sendQuote: false,
  applyDiscount: false,
  applyUnrestrictedDiscount: false,
  approveDiscount: false,
  acceptOnBehalf: false,
  rejectQuote: false,
  convertToBooking: false,
  viewMargin: false,
};

const CAPABILITIES: Record<StaffRole, QuotesCapabilities> = {
  ADMIN: {
    ...NONE,
    viewModule: true,
    createQuote: true,
    editQuote: true,
    sendQuote: true,
    applyDiscount: true,
    applyUnrestrictedDiscount: true,
    approveDiscount: true,
    acceptOnBehalf: true,
    rejectQuote: true,
    convertToBooking: true,
    viewMargin: true,
  },
  // Same posture as leads-access.ts's MARKETING row: can draft, send and
  // convert; a discount it applies still lands PENDING_APPROVAL for Admin
  // (applyUnrestrictedDiscount stays false).
  MARKETING: {
    ...NONE,
    viewModule: true,
    createQuote: true,
    editQuote: true,
    sendQuote: true,
    applyDiscount: true,
    acceptOnBehalf: true,
    rejectQuote: true,
    convertToBooking: true,
  },
  // Read-only pipeline oversight, same as leads-access.ts's CEO row — plus
  // margin visibility, since a quote's discount directly affects it.
  CEO: { ...NONE, viewModule: true, viewMargin: true },
  // Sees quotes for financial context (margin, discount approvals) but
  // never drafts or sends one.
  FINANCE: { ...NONE, viewModule: true, viewMargin: true },
  // No quote visibility in leads-access.ts either (`viewQuotes` was never
  // set for these roles) — kept identical here rather than newly exposing
  // this page to a role that couldn't see it before.
  OPERATIONS: { ...NONE },
  VISA: { ...NONE },
  GUIDE: { ...NONE },
};

export function capabilitiesForQuotes(role: StaffRole): QuotesCapabilities {
  return CAPABILITIES[role];
}
