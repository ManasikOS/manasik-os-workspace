/**
 * Row types for Guides & Field Team.
 *
 * Keep in sync with `supabase/migrations/20261024090000_guide_field_team.sql`.
 * Assignment ("who is guiding which group") stays in `staff_group_assignments`
 * — see `lib/types/team.ts` — and is not duplicated here.
 */

export type FieldCheckinStatus = "ALL_CLEAR" | "DELAY" | "ISSUE" | "EMERGENCY";
export type GuideHandoverStatus = "PENDING" | "ACKNOWLEDGED";

export interface GuideProfileRow {
  id: string;
  staff_id: string;
  languages: string[];
  certifications: string | null;
  years_experience: number | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface GuideBriefingRow {
  id: string;
  departure_group_id: string;
  staff_id: string;
  title: string;
  content: string;
  acknowledged_at: string | null;
  created_by_name: string;
  created_at: string;
}

export interface GuideHandoverRow {
  id: string;
  departure_group_id: string;
  from_staff_id: string | null;
  to_staff_id: string;
  handover_notes: string;
  status: GuideHandoverStatus;
  created_by_name: string;
  created_at: string;
  acknowledged_at: string | null;
}

export interface FieldCheckinRow {
  id: string;
  departure_group_id: string;
  staff_id: string;
  status: FieldCheckinStatus;
  note: string | null;
  created_at: string;
}

export interface GuideBriefingWithGroup extends GuideBriefingRow {
  groupName: string;
}

export interface GuideHandoverWithNames extends GuideHandoverRow {
  groupName: string;
  fromName: string | null;
  toName: string;
}

export interface FieldCheckinWithGroup extends FieldCheckinRow {
  groupName: string;
}
