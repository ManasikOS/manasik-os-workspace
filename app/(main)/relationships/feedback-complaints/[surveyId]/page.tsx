import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getSurvey, listSurveyQuestions, listSurveyResponses } from "@/lib/data/feedback-repository";
import { createClient } from "@/utils/supabase/server";

import SurveyDetailView from "./components/survey-detail-view";

export default async function SurveyDetailPage({
  params,
}: {
  params: Promise<{ surveyId: string }>;
}) {
  const { surveyId } = await params;
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const survey = await getSurvey(supabase, surveyId);
  if (!survey) notFound();

  const [questions, responses] = await Promise.all([
    listSurveyQuestions(supabase, surveyId),
    listSurveyResponses(supabase, surveyId),
  ]);

  return (
    <SurveyDetailView
      survey={survey}
      questions={questions}
      responses={responses}
      canManage={can.manageSupportRequests}
    />
  );
}
