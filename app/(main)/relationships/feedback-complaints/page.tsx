import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listAllSupportRequests } from "@/lib/data/support-repository";
import { listSurveysWithStats } from "@/lib/data/feedback-repository";
import { createClient } from "@/utils/supabase/server";

import FeedbackComplaintsView from "./components/feedback-complaints-view";

/**
 * Feedback & Complaints (M12). Complaints reuse pilgrim_support_requests
 * (category = 'COMPLAINT') rather than a separate table — see
 * supabase/migrations/20261019090000_feedback_surveys.sql. Feedback is a
 * new satisfaction-survey model, recorded by staff from responses collected
 * out-of-band.
 */
export default async function FeedbackComplaintsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const [allRequests, surveys] = await Promise.all([
    listAllSupportRequests(supabase),
    listSurveysWithStats(supabase).catch(() => []),
  ]);

  const complaints = allRequests.filter((r) => r.category === "COMPLAINT");

  return (
    <FeedbackComplaintsView
      complaints={complaints}
      surveys={surveys}
      canManage={can.manageSupportRequests}
    />
  );
}
