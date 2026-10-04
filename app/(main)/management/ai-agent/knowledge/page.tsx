import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";

import SectionHeading from "@/components/section-heading";
import { PermissionDenied } from "@/components/ui/tone-badge";
import { capabilitiesForAiAgent } from "@/lib/access/ai-agent-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { createClient } from "@/utils/supabase/server";

import { KnowledgeArticleSheet } from "./knowledge-article-sheet";
import { KnowledgeBaseSwitch } from "./knowledge-base-switch";
import { KnowledgeDocumentList, type KnowledgeDocumentRow } from "./knowledge-document-list";
import { KnowledgeUploadSheet } from "./knowledge-upload-sheet";
import { UnansweredQuestionsSection } from "./unanswered-questions-section";
import { ApprovedInboxAnswers, type ApprovedAnswerCandidate } from "./approved-answers";
import { capabilitiesForInsights } from "@/lib/access/insights-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { resolveEntitlements } from "@/lib/billing/entitlements";
import { resolveInboxFeatureAvailability } from "@/lib/inbox/feature-availability";

export const dynamic = "force-dynamic";

export default async function KnowledgeBasePage() {
  const { role, roleId, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForAiAgent(role);

  if (!can.viewModule) return <PermissionDenied what="The assistant's documents" />;

  const supabase = createClient(await cookies());
  const [{ data: documentRows, error: documentsError }, { data: settingsRow }, { data: answerRows }, insightCapabilities, entitlements] = await Promise.all([
    supabase
      .from("knowledge_documents")
      .select("id, title, document_kind, language, is_active, status, status_detail, has_price_warning, chunk_count, uploaded_by_name, updated_at, source_kind, article_id")
      .eq("agency_id", agencyId ?? "")
      .order("created_at", { ascending: false }),
    supabase.from("ai_settings").select("knowledge_base_enabled").eq("agency_id", agencyId ?? "").maybeSingle(),
    supabase.from("conversation_answer_cache").select("id, normalized_question, answer_text, occurrence_count").eq("agency_id", agencyId ?? "").eq("status", "CANDIDATE").gte("occurrence_count", 3).order("occurrence_count", { ascending: false }),
    loadDynamicCapabilities(supabase, roleId, "insights", capabilitiesForInsights(role)),
    agencyId ? resolveEntitlements(supabase, agencyId) : Promise.resolve(null),
  ]);

  const rawDocuments = (documentRows as (Omit<KnowledgeDocumentRow, "article_body"> & { article_id: string | null })[] | null) ?? [];

  // Written policies keep their text in knowledge_articles; fetch it so the edit sheet can open pre-filled.
  const articleIds = rawDocuments.flatMap((document) => (document.article_id ? [document.article_id] : []));
  const { data: articleRows } =
    articleIds.length > 0
      ? await supabase.from("knowledge_articles").select("id, body").eq("agency_id", agencyId ?? "").in("id", articleIds)
      : { data: [] as { id: string; body: string }[] };
  const bodyByArticleId = new Map(((articleRows ?? []) as { id: string; body: string }[]).map((article) => [article.id, article.body]));
  const documents: KnowledgeDocumentRow[] = rawDocuments.map((document) => ({
    ...document,
    article_body: document.article_id ? (bodyByArticleId.get(document.article_id) ?? null) : null,
  }));
  const knowledgeBaseEnabled = (settingsRow as { knowledge_base_enabled: boolean } | null)?.knowledge_base_enabled ?? false;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <Link href="/management/ai-agent" className="text-xs text-muted-foreground underline">
          Back to Manasik Copilot
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Assistant documents</h1>
        <p className="text-sm text-muted-foreground">
          Give the assistant your own written policies and guides — it uses them on every channel. It answers questions about them in plain language and says
          which document it used.
        </p>
      </div>

      <KnowledgeBaseSwitch initiallyEnabled={knowledgeBaseEnabled} canManage={can.manageKnowledgeBase} />

      <SectionHeading
        title="Documents"
        description="PDF, text and Markdown files up to 10 MB. Scanned PDFs can't be read — use a PDF saved from a document."
        act={
          can.manageKnowledgeBase && agencyId ? (
            <div className="flex gap-2">
              <KnowledgeArticleSheet />
              <KnowledgeUploadSheet agencyId={agencyId} />
            </div>
          ) : undefined
        }
      />

      {documentsError ? (
        <p role="alert" className="text-sm text-destructive">
          We could not load your documents. Reload the page to try again.
        </p>
      ) : (
        <KnowledgeDocumentList documents={documents} canManage={can.manageKnowledgeBase} />
      )}

      {can.viewAnalytics && agencyId && (
        <Suspense fallback={null}>
          <UnansweredQuestionsSection agencyId={agencyId} />
        </Suspense>
      )}

      {resolveInboxFeatureAvailability({ entitlements, inboxQueuesV2: false }).answerCache && (
        <ApprovedInboxAnswers candidates={(answerRows ?? []) as ApprovedAnswerCandidate[]} canApprove={insightCapabilities.approveInboxAnswer} />
      )}
    </div>
  );
}
