/**
 * Where a knowledge document is queued to be read and embedded: the `EMBED_DOCUMENT` job on `agent_jobs`, run by the queue drain (decision R9).
 * There used to be a second runner, an Inngest function behind `INNGEST_KNOWLEDGE_INGEST`; it was never switched on, and it is gone.
 */

import "server-only";

import type { Db } from "@/lib/data/whatsapp-repository";
import { enqueueJob } from "@/lib/data/whatsapp-repository";

/** Queues the document for reading and embedding. The caller kicks the drain afterwards so the job starts without waiting for the next tick. */
export async function queueKnowledgeIngest(db: Db, input: { agencyId: string; documentId: string }): Promise<void> {
  await enqueueJob(db, { agencyId: input.agencyId, kind: "EMBED_DOCUMENT", payload: { documentId: input.documentId } });
}
