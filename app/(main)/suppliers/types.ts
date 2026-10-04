/**
 * View models and UI-only types for the Supplier Directory.
 *
 * Row-level derivation lives in `lib/data/suppliers.ts` (client-safe) and
 * `lib/data/suppliers-repository.ts` (server only); the flat shapes they
 * produce are re-exported here so no component reaches past this file — same
 * convention as `app/(main)/pilgrims/types.ts` and `app/(main)/operations/types.ts`.
 */

export type {
  SupplierKpis,
  SupplierListItem,
  SupplierProfile,
  SupplierProfileStats,
} from "@/lib/data/suppliers";
export type { SupplierCapabilities, SupplierTabId } from "@/lib/access/suppliers-access";
export type {
  SupplierActivityAction,
  SupplierActivityEventRow,
  SupplierCommitmentLinkedEntityType,
  SupplierCommitmentPaymentStatus,
  SupplierCommitmentRow,
  SupplierCommitmentStatus,
  SupplierContactRow,
  SupplierCurrency,
  SupplierPaymentRow,
  SupplierPaymentTerms,
  SupplierPreferredChannel,
  SupplierReliability,
  SupplierRow,
  SupplierServiceCategory,
  SupplierServiceRow,
  SupplierServiceSeason,
  SupplierStatus,
  SupplierType,
} from "@/lib/types/suppliers";

/* ── Saved views ──────────────────────────────────────────────────────────── */

export const SUPPLIER_SAVED_VIEWS = [
  "All Suppliers",
  "Makkah Suppliers",
  "Madinah Suppliers",
  "Hotels",
  "Transport Providers",
  "Catering",
  "Ticketing Agents",
  "Brokers",
  "Active Group Commitments",
  "Confirmations Pending",
  "Inactive Suppliers",
] as const;

export type SupplierSavedView = (typeof SUPPLIER_SAVED_VIEWS)[number];

/* ── Filters ──────────────────────────────────────────────────────────────── */

export const ALL = "ALL";

export interface SupplierFilters {
  supplierType: string;
  serviceCategory: string;
  location: string;
  activeStatus: string;
  commitmentStatus: string;
  reliability: string;
  paymentStatus: string;
}

export const EMPTY_SUPPLIER_FILTERS: SupplierFilters = {
  supplierType: ALL,
  serviceCategory: ALL,
  location: ALL,
  activeStatus: ALL,
  commitmentStatus: ALL,
  reliability: ALL,
  paymentStatus: ALL,
};

export type SupplierQuickFilter = "confirmationsPending" | "issues" | "paymentsDue";
