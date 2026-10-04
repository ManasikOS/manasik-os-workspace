import "server-only";

import type { Db } from "@/lib/data/whatsapp-repository";

/**
 * The assistant only gets the knowledge tool when the agency switched it on AND there is at least
 * one active, ready document to search. With nothing to search the tool is absent, so the assistant
 * never offers an answer it cannot give (plan §7).
 */
export async function isKnowledgeBaseAvailable(db: Db, agencyId: string): Promise<boolean> {
  const { data: settings } = await db
    .from("ai_settings")
    .select("knowledge_base_enabled")
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!(settings as { knowledge_base_enabled: boolean } | null)?.knowledge_base_enabled) return false;

  const { count } = await db
    .from("knowledge_documents")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", agencyId)
    .eq("is_active", true)
    .eq("status", "READY");
  return (count ?? 0) > 0;
}
