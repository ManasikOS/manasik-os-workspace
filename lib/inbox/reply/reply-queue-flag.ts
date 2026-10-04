/**
 * Whether an agency's AI replies run as REPLY jobs on `channel_jobs` (Q1) rather than as `agent_jobs`. The switch is a row in
 * `inbox_reply_queue_agencies`, which only the service role can write, so a tenant cannot move itself over. The inbound
 * database function reads the same table to route the first reply; this is for the code that queues a reply later (a voice
 * note, once it has been transcribed).
 *
 * A read that fails answers "not enabled": the legacy path is the safe one, and it is the one every other agency is on.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";

export async function isReplyQueueEnabled(db: Db, agencyId: string): Promise<boolean> {
  const { data, error } = await db.from("inbox_reply_queue_agencies").select("agency_id").eq("agency_id", agencyId).maybeSingle();
  if (error) {
    console.error("Could not read the reply-queue rollout flag; using the legacy path:", error.message);
    return false;
  }
  return data !== null;
}
