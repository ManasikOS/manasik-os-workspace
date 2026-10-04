import { cookies } from "next/headers";

import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listOpenGroupsForBookingPicker } from "@/lib/data/bookings-repository";
import { listAnnouncementsWithReach } from "@/lib/data/announcements-repository";
import { listAudiences } from "@/lib/data/audiences-repository";
import { createClient } from "@/utils/supabase/server";
import type { WhatsAppTemplateRow } from "@/lib/types/whatsapp";

import AnnouncementsView from "./components/announcements-view";

/**
 * Announcements (M13 partial) — broadcast composer targeting a departure
 * group or a saved Audience, with consent applied at send time and
 * read/acknowledgement tracking after. WhatsApp now dispatches for real
 * through the agency's connected WhatsApp Business number — see
 * supabase/migrations/20261023090000_announcements_whatsapp_dispatch.sql
 * and app/(main)/relationships/announcements/actions.ts. Every other
 * channel (Portal/Email/SMS/In-app) still has no dispatch integration.
 */
export default async function AnnouncementsPage() {
  const { role } = await getCurrentStaffRole();
  const canManage = role === "ADMIN" || role === "CEO" || role === "MARKETING" || role === "OPERATIONS";

  const supabase = createClient(await cookies());
  const [announcements, groups, audiences, whatsappTemplatesResult] = await Promise.all([
    listAnnouncementsWithReach(supabase).catch(() => []),
    listOpenGroupsForBookingPicker(supabase).catch(() => []),
    listAudiences(supabase).catch(() => []),
    supabase.from("whatsapp_templates").select("*").eq("status", "APPROVED").order("name", { ascending: true }),
  ]);

  return (
    <AnnouncementsView
      announcements={announcements}
      groups={groups}
      audiences={audiences}
      whatsappTemplates={(whatsappTemplatesResult.data ?? []) as WhatsAppTemplateRow[]}
      canManage={canManage}
    />
  );
}
