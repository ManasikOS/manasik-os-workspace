/**
 * Row types for Pilgrim Portal access.
 *
 * Keep in sync with `supabase/migrations/20261018090000_pilgrim_portal_access.sql`.
 * Portal content visibility itself lives in `lib/types/settings.ts` (`PortalFlags`,
 * `AgencySettingsRow.portal_active`) — this file only covers per-pilgrim access.
 */

export type PortalAccountStatus = "NOT_INVITED" | "INVITED" | "ACTIVE" | "REVOKED";

export type PortalAccessEventType =
  | "INVITED"
  | "ACTIVATED"
  | "REVOKED"
  | "LOGIN"
  | "VIEWED_ITINERARY"
  | "VIEWED_DOCUMENTS"
  | "VIEWED_PAYMENTS"
  | "SUPPORT_REQUEST_SUBMITTED";

export interface PortalAccountRow {
  id: string;
  pilgrim_id: string;
  status: PortalAccountStatus;
  invited_at: string | null;
  invited_by_name: string | null;
  activated_at: string | null;
  revoked_at: string | null;
  revoked_by_name: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortalAccessEventRow {
  id: string;
  pilgrim_id: string;
  event_type: PortalAccessEventType;
  actor_name: string;
  created_at: string;
}

export interface PortalPilgrimSummary {
  pilgrimId: string;
  fullName: string;
  reference: string;
  whatsappNumber: string;
  journeyStatus: string;
  account: PortalAccountRow | null;
  eventCount: number;
}
