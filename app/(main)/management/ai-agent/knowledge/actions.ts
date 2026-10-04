"use server";

/**
 * Knowledge base Server Actions — see docs/modules/whatsapp-knowledge-base-implementation-plan.md §6.
 *
 * The browser uploads the file straight to the private `knowledge-base` bucket (a Server Action
 * body is capped far below 10 MB), then calls `registerKnowledgeDocumentAction`, which re-reads the
 * stored file, hashes it, rejects a duplicate and queues the `EMBED_DOCUMENT` job. Writes run on the
 * session client, so `knowledge_documents` RLS (ADMIN-only write) is the real enforcement; the
 * `manageKnowledgeBase` check is the fast, friendly rejection.
 */

import { createHash } from "node:crypto";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { capabilitiesForAiAgent } from "@/lib/access/ai-agent-access";
import { processDueJobs } from "@/lib/agent/whatsapp/drain";
import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { queueKnowledgeIngest } from "@/lib/agent/whatsapp/knowledge/queue";
import {
  knowledgeArticleSchema,
  knowledgeDocumentIdSchema,
  registerKnowledgeDocumentSchema,
  setKnowledgeDocumentActiveSchema,
} from "@/lib/validations/knowledge-base";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

const KNOWLEDGE_BUCKET = "knowledge-base";
const KNOWLEDGE_PAGE = "/management/ai-agent/knowledge";

export type KnowledgeActionResult = { ok: true } | { ok: false; error: string };

type Guard =
  | { ok: true; agencyId: string; userId: string; userName: string | null }
  | { ok: false; error: string };

async function guardKnowledgeWrite(): Promise<Guard> {
  const user = await requireUser();
  const { role, agencyId, name } = await getCurrentStaffRole();
  if (!capabilitiesForAiAgent(role).manageKnowledgeBase) {
    return { ok: false, error: "Your role cannot manage the assistant's documents." };
  }
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };
  return { ok: true, agencyId, userId: user.id, userName: name };
}

/** Kicks the queue right away so the person sees progress in seconds; the cron is the guarantee. */
function drainSoon(): void {
  after(() => processDueJobs({ budgetMs: 25_000 }).catch((error) => console.error("Knowledge drain (after) failed:", error)));
}

export async function registerKnowledgeDocumentAction(input: unknown): Promise<KnowledgeActionResult> {
  const guard = await guardKnowledgeWrite();
  if (!guard.ok) return guard;

  const parsed = registerKnowledgeDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  const data = parsed.data;

  // The path must sit inside this agency's folder — never trust a path the browser made up.
  if (!data.storagePath.startsWith(`${guard.agencyId}/`) || data.storagePath.includes("..")) {
    return { ok: false, error: "The uploaded file could not be found." };
  }

  const supabase = createClient(await cookies());
  const download = await supabase.storage.from(KNOWLEDGE_BUCKET).download(data.storagePath);
  if (download.error || !download.data) return { ok: false, error: "The uploaded file could not be found. Try uploading it again." };

  const bytes = Buffer.from(await download.data.arrayBuffer());
  const contentHash = createHash("sha256").update(bytes).digest("hex");

  const discardUpload = () => supabase.storage.from(KNOWLEDGE_BUCKET).remove([data.storagePath]).then(() => undefined, () => undefined);

  const { data: existing } = await supabase
    .from("knowledge_documents")
    .select("title")
    .eq("agency_id", guard.agencyId)
    .eq("content_hash", contentHash)
    .maybeSingle();
  if (existing) {
    await discardUpload();
    return { ok: false, error: `This file is already uploaded as "${(existing as { title: string }).title}".` };
  }

  const { data: inserted, error } = await supabase
    .from("knowledge_documents")
    .insert({
      agency_id: guard.agencyId,
      title: data.title,
      source_kind: "UPLOAD",
      storage_path: data.storagePath,
      mime_type: data.mimeType,
      byte_size: bytes.length,
      content_hash: contentHash,
      document_kind: data.documentKind,
      language: data.language,
      uploaded_by: guard.userId,
      uploaded_by_name: guard.userName,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    await discardUpload();
    return { ok: false, error: "We couldn't save this document. Please try again." };
  }

  await queueKnowledgeIngest(createAdminClient(), { agencyId: guard.agencyId, documentId: (inserted as { id: string }).id });
  drainSoon();

  revalidatePath(KNOWLEDGE_PAGE);
  return { ok: true };
}

/** Creates or edits a policy typed straight into the app; it goes through the same reading pipeline as a file. */
export async function saveKnowledgeArticleAction(input: unknown): Promise<KnowledgeActionResult> {
  const guard = await guardKnowledgeWrite();
  if (!guard.ok) return guard;

  const parsed = knowledgeArticleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  const data = parsed.data;

  const supabase = createClient(await cookies());
  let documentId: string;

  if (data.documentId) {
    const { data: existing } = await supabase
      .from("knowledge_documents")
      .select("id, article_id")
      .eq("id", data.documentId)
      .eq("agency_id", guard.agencyId)
      .eq("source_kind", "ARTICLE")
      .maybeSingle();
    const articleId = (existing as { article_id: string | null } | null)?.article_id;
    if (!existing || !articleId) return { ok: false, error: "This document could not be found." };

    const { error: articleError } = await supabase
      .from("knowledge_articles")
      .update({ title: data.title, body: data.body, category: data.documentKind, language: data.language })
      .eq("id", articleId)
      .eq("agency_id", guard.agencyId);
    if (articleError) return { ok: false, error: "We couldn't save your changes. Please try again." };

    const { error: documentError } = await supabase
      .from("knowledge_documents")
      .update({ title: data.title, document_kind: data.documentKind, language: data.language, status: "UPLOADED", status_detail: null })
      .eq("id", data.documentId)
      .eq("agency_id", guard.agencyId);
    if (documentError) return { ok: false, error: "We couldn't save your changes. Please try again." };
    documentId = data.documentId;
  } else {
    const { data: article, error: articleError } = await supabase
      .from("knowledge_articles")
      .insert({
        agency_id: guard.agencyId,
        title: data.title,
        body: data.body,
        category: data.documentKind,
        language: data.language,
        created_by: guard.userId,
      })
      .select("id")
      .single();
    if (articleError || !article) return { ok: false, error: "We couldn't save this policy. Please try again." };
    const articleId = (article as { id: string }).id;

    const { data: document, error: documentError } = await supabase
      .from("knowledge_documents")
      .insert({
        agency_id: guard.agencyId,
        title: data.title,
        source_kind: "ARTICLE",
        article_id: articleId,
        document_kind: data.documentKind,
        language: data.language,
        uploaded_by: guard.userId,
        uploaded_by_name: guard.userName,
      })
      .select("id")
      .single();
    if (documentError || !document) {
      // No half-saved policy: remove the article so nothing is left that the screen can't show.
      await supabase.from("knowledge_articles").delete().eq("id", articleId).eq("agency_id", guard.agencyId);
      return { ok: false, error: "We couldn't save this policy. Please try again." };
    }
    documentId = (document as { id: string }).id;
  }

  await queueKnowledgeIngest(createAdminClient(), { agencyId: guard.agencyId, documentId });
  drainSoon();

  revalidatePath(KNOWLEDGE_PAGE);
  return { ok: true };
}

export async function setKnowledgeDocumentActiveAction(input: unknown): Promise<KnowledgeActionResult> {
  const guard = await guardKnowledgeWrite();
  if (!guard.ok) return guard;
  const parsed = setKnowledgeDocumentActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This document could not be found." };

  const supabase = createClient(await cookies());
  const { error } = await supabase
    .from("knowledge_documents")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.documentId)
    .eq("agency_id", guard.agencyId);
  if (error) return { ok: false, error: "We couldn't update this document. Please try again." };

  revalidatePath(KNOWLEDGE_PAGE);
  return { ok: true };
}

export async function reindexKnowledgeDocumentAction(input: unknown): Promise<KnowledgeActionResult> {
  const guard = await guardKnowledgeWrite();
  if (!guard.ok) return guard;
  const parsed = knowledgeDocumentIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This document could not be found." };

  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("knowledge_documents")
    .update({ status: "UPLOADED", status_detail: null })
    .eq("id", parsed.data.documentId)
    .eq("agency_id", guard.agencyId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "We couldn't find this document." };

  await queueKnowledgeIngest(createAdminClient(), { agencyId: guard.agencyId, documentId: parsed.data.documentId });
  drainSoon();

  revalidatePath(KNOWLEDGE_PAGE);
  return { ok: true };
}

export async function deleteKnowledgeDocumentAction(input: unknown): Promise<KnowledgeActionResult> {
  const guard = await guardKnowledgeWrite();
  if (!guard.ok) return guard;
  const parsed = knowledgeDocumentIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This document could not be found." };

  const supabase = createClient(await cookies());
  const { data: row } = await supabase
    .from("knowledge_documents")
    .select("storage_path, source_kind, article_id")
    .eq("id", parsed.data.documentId)
    .eq("agency_id", guard.agencyId)
    .maybeSingle();
  if (!row) return { ok: false, error: "This document could not be found." };

  const { source_kind: sourceKind, article_id: articleId } = row as { source_kind: string; article_id: string | null };
  if (sourceKind === "ARTICLE" && articleId) {
    // Deleting the written policy removes its document row and pieces too (on delete cascade).
    const { error: articleError } = await supabase.from("knowledge_articles").delete().eq("id", articleId).eq("agency_id", guard.agencyId);
    if (articleError) return { ok: false, error: "We couldn't delete this document. Please try again." };
    revalidatePath(KNOWLEDGE_PAGE);
    return { ok: true };
  }

  // Row first (its pieces cascade). If that fails nothing is lost; a leftover file is harmless.
  const { error } = await supabase
    .from("knowledge_documents")
    .delete()
    .eq("id", parsed.data.documentId)
    .eq("agency_id", guard.agencyId);
  if (error) return { ok: false, error: "We couldn't delete this document. Please try again." };

  const storagePath = (row as { storage_path: string | null }).storage_path;
  if (storagePath) await supabase.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]).catch(() => undefined);

  revalidatePath(KNOWLEDGE_PAGE);
  return { ok: true };
}

export async function setKnowledgeBaseEnabledAction(enabled: unknown): Promise<KnowledgeActionResult> {
  const guard = await guardKnowledgeWrite();
  if (!guard.ok) return guard;
  if (typeof enabled !== "boolean") return { ok: false, error: "Choose on or off." };

  const supabase = createClient(await cookies());
  const { error } = await supabase.from("ai_settings").update({ knowledge_base_enabled: enabled }).eq("agency_id", guard.agencyId);
  if (error) return { ok: false, error: "We couldn't save this setting. Please try again." };

  revalidatePath(KNOWLEDGE_PAGE);
  return { ok: true };
}
