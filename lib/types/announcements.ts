/**
 * Row types for Announcements.
 *
 * Keep in sync with `supabase/migrations/20261017090000_announcements.sql`
 * and `supabase/migrations/20261023090000_announcements_whatsapp_dispatch.sql`.
 */

export type AnnouncementChannel = "PORTAL" | "WHATSAPP" | "EMAIL" | "SMS" | "IN_APP";
export type AnnouncementTargetType = "DEPARTURE_GROUP" | "AUDIENCE";
export type AnnouncementStatus = "DRAFT" | "SCHEDULED" | "SENT" | "CANCELLED";

export interface AnnouncementRow {
  id: string;
  agency_id: string;
  title: string;
  body: string;
  channel: AnnouncementChannel;
  target_type: AnnouncementTargetType;
  departure_group_id: string | null;
  audience_id: string | null;
  whatsapp_template_id: string | null;
  whatsapp_template_param: string | null;
  status: AnnouncementStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementRecipientRow {
  id: string;
  announcement_id: string;
  subject_type: "LEAD" | "PILGRIM";
  subject_id: string;
  contactable: boolean;
  exclusion_reason: string | null;
  delivery_error: string | null;
  delivered_at: string | null;
  read_at: string | null;
  acknowledged_at: string | null;
}

/** Live-computed reach summary, never stored on the announcement itself. */
export interface AnnouncementReach {
  targetName: string;
  totalRecipients: number;
  contactableCount: number;
  deliveredCount: number;
  failedCount: number;
  readCount: number;
  acknowledgedCount: number;
}

export interface AnnouncementWithReach extends AnnouncementRow {
  reach: AnnouncementReach;
}
