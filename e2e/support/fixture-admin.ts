import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { assertInboxLr2FixtureTarget, inboxLr2FixtureAgencySlugs } from "../../scripts/e2e/inbox-lr2-fixtures-config";

/**
 * A service-role client for the few things a browser cannot do or check: counting what a test left behind, creating a throwaway
 * conversation, removing it again. It refuses anything that is not a named non-production project (the same rule as the seeder), and
 * it is only ever pointed at the two fixture agencies. A test that needs it fails with a plain message when the key is not set.
 */
export function createFixtureAdminClient(values: Record<string, string | undefined> = process.env): SupabaseClient {
  const target = assertInboxLr2FixtureTarget(values);
  const secretKey = values.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("This test needs SUPABASE_SECRET_KEY (the non-production project's service key) to check or clean up what it created.");
  return createClient(target.url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function fixtureAgencyId(db: SupabaseClient, agency: keyof typeof inboxLr2FixtureAgencySlugs): Promise<string> {
  const found = await db.from("agencies").select("id").eq("slug", inboxLr2FixtureAgencySlugs[agency]).single();
  if (found.error) throw new Error(`Fixture agency ${agency} not found: ${found.error.message}. Run the seeder first.`);
  return found.data.id as string;
}

/**
 * Removes a conversation a test created, with the rows that point at it, so the fixtures are as they were. Queue membership is left to the
 * conversation's own delete (it cascades, and the delete trigger keeps the queue counts right); deleting it by hand would skip that.
 */
export async function deleteTestConversation(db: SupabaseClient, conversationId: string): Promise<void> {
  const children = ["outbox_messages", "conversation_messages", "conversation_drafts", "conversation_notes", "conversation_events"] as const;
  for (const table of children) {
    const removed = await db.from(table).delete().eq("conversation_id", conversationId);
    if (removed.error) throw new Error(`Could not clean ${table} for the test conversation: ${removed.error.message}`);
  }
  const removed = await db.from("conversations").delete().eq("id", conversationId);
  if (removed.error) throw new Error(`Could not remove the test conversation: ${removed.error.message}`);
}
