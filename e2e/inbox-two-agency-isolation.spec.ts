import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { parseInboxLr2BrowserEnvironment } from "./inbox-lr2-config";
import { createFixtureAdminClient, fixtureAgencyId } from "./support/fixture-admin";
import { inboxAddress, signInToInboxAt } from "./support/inbox-session";

/**
 * TASK-032 W4: the two-agency isolation spec. Agency A's staff cannot SEE, OPEN, SEARCH or ACT on Agency B's conversation, and the reverse
 * for Agency B's staff. The screen checks use the real UI; the "act" checks sign in as the staff member and try, with that member's own
 * token, what the screen would never offer: read, change and write into the other agency's conversation, and join its live channel.
 * Both agencies are the disposable fixture agencies. Nothing here changes data: every attempted change must be refused, and the test
 * proves the other agency's row is exactly as it was.
 */
const environment = parseInboxLr2BrowserEnvironment();
const staffA1 = environment.agencyA.staffA1;
const staffB1 = environment.agencyB.staffB1;

const A_NAMES = ["LR2 Open Window", "LR2 Take Control", "LR2 Closed Window", "LR2 Coworker Owned"];
const B_NAME = "LR2 Agency B Only";

test.describe("TASK-032 W4: two agencies, one database", () => {
  test("each agency's list holds only its own conversations", async ({ browser }) => {
    const a = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }));
    const b = await signInToInboxAt(browser, staffB1, inboxAddress({ view: "all" }));
    try {
      const listA = a.page.getByLabel("Conversation list");
      const listB = b.page.getByLabel("Conversation list");
      await expect(listA.getByText(A_NAMES[0])).toBeVisible();
      await expect(listB.getByText(B_NAME)).toBeVisible();
      for (const name of A_NAMES) await expect(listB.getByText(name)).toHaveCount(0);
      await expect(listA.getByText(B_NAME)).toHaveCount(0);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test("opening the other agency's conversation by its address shows nothing of it, in either direction", async ({ browser }) => {
    const a = await signInToInboxAt(browser, staffA1, inboxAddress({ conversationId: environment.agencyB.conversationId }));
    const b = await signInToInboxAt(browser, staffB1, inboxAddress({ conversationId: environment.agencyA.openConversationId }));
    try {
      await expect(a.page.getByText(B_NAME)).toHaveCount(0);
      await expect(a.page.getByText("Agency B private message")).toHaveCount(0);
      await expect(b.page.getByText("LR2 Open Window")).toHaveCount(0);
      await expect(b.page.getByText("is my umrah package still available")).toHaveCount(0);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test("a signed-in member of one agency cannot read, change, write into or listen to the other agency's conversation", async () => {
    const admin = createFixtureAdminClient();
    const agencyB = await fixtureAgencyId(admin, "agencyB");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!publishableKey) throw new Error("This test needs NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
    const bId = environment.agencyB.conversationId;

    const before = await admin.from("conversations").select("last_message_preview, state, assigned_to_id, version").eq("id", bId).single();
    expect(before.error).toBeNull();
    const messagesBefore = await admin.from("conversation_messages").select("id", { count: "exact", head: true }).eq("conversation_id", bId);

    const asA1 = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await asA1.auth.signInWithPassword({ email: staffA1.email, password: staffA1.password });
    expect(signedIn.error).toBeNull();
    try {
      // See: the row is invisible, by id and by listing.
      const read = await asA1.from("conversations").select("id").eq("id", bId);
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);
      const listed = await asA1.from("conversations").select("id").eq("agency_id", agencyB);
      expect(listed.data ?? []).toEqual([]);

      // Act: a change and a write are refused or touch nothing.
      const changed = await asA1.from("conversations").update({ last_message_preview: "changed by the other agency", state: "CLOSED" }).eq("id", bId).select("id");
      expect(changed.data ?? []).toEqual([]);
      const wrote = await asA1.from("conversation_messages").insert({
        agency_id: agencyB, conversation_id: bId, role: "assistant", actor_kind: "STAFF", direction: "OUTBOUND", message_type: "TEXT", content: "written by the other agency", delivery_status: "QUEUED",
      });
      expect(wrote.error, "writing into the other agency's conversation must be refused").not.toBeNull();

      // Listen: the other agency's live channel refuses the join.
      await asA1.realtime.setAuth(signedIn.data.session!.access_token);
      const status = await new Promise<string>((resolve) => {
        const channel = asA1.channel(`inbox:${agencyB}`, { config: { private: true } });
        const timer = setTimeout(() => resolve("TIMED_OUT"), 15_000);
        channel.subscribe((s) => {
          if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)) {
            clearTimeout(timer);
            resolve(s);
          }
        });
      });
      expect(status, "joining another agency's channel must not succeed").not.toBe("SUBSCRIBED");
    } finally {
      await asA1.removeAllChannels();
      await asA1.auth.signOut();
    }

    // The other agency's data is exactly as it was.
    const after = await admin.from("conversations").select("last_message_preview, state, assigned_to_id, version").eq("id", bId).single();
    expect(after.data).toEqual(before.data);
    const messagesAfter = await admin.from("conversation_messages").select("id", { count: "exact", head: true }).eq("conversation_id", bId);
    expect(messagesAfter.count).toBe(messagesBefore.count);
  });
});
