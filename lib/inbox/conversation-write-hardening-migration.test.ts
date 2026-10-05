import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** SEC-1 / SEC-2 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): the rules that keep staff from rewriting server-owned fields or forging messages. */
const migration = readFileSync(join(process.cwd(), "supabase/migrations/20270111090000_inbox_conversation_write_hardening.sql"), "utf8");
const actions = readFileSync(join(process.cwd(), "app/inbox/actions.ts"), "utf8");

describe("inbox conversation write hardening migration", () => {
  it("replaces the FOR ALL conversations policy with insert, update and administrator-only delete", () => {
    expect(migration).toContain('drop policy if exists "staff write conversations" on public.conversations;');
    expect(migration).toMatch(/create policy conversations_admin_delete on public\.conversations\s+for delete to authenticated\s+using \(agency_id = public\.current_agency_id\(\) and public\.staff_role_in\('ADMIN'\)\)/);
    expect(migration).not.toMatch(/for all to authenticated/);
  });

  it.each(["service_window_expires_at", "human_agent_window_expires_at", "channel", "external_conversation_id", "agency_id", "lead_id"])(
    "refuses a direct user change to %s",
    (column) => {
      expect(migration).toContain(`new.${column} is distinct from old.${column}`);
    },
  );

  it("lets the server (any role other than authenticated) through, and runs before every insert and update", () => {
    expect(migration).toContain("if current_user <> 'authenticated' then");
    expect(migration).toMatch(/create trigger conversations_guard_protected_columns\s+before insert or update on public\.conversations/);
  });

  it("drops the direct message insert policy and adds a definer function that sets the author from auth.uid()", () => {
    expect(migration).toContain('drop policy if exists "staff insert conversation_messages" on public.conversation_messages;');
    expect(migration).toMatch(/function public\.record_staff_template_message[\s\S]*security definer[\s\S]*set search_path = ''/);
    expect(migration).toContain("'staff', 'STAFF', auth.uid()");
    expect(migration).toContain("revoke all on function public.record_staff_template_message(uuid, text, text, jsonb) from public, anon;");
  });

  it("is what the Inbox actions now call, with no direct message insert left", () => {
    expect(actions).not.toMatch(/from\("conversation_messages"\)\.insert/);
    expect(actions.match(/rpc\("record_staff_template_message"/g)).toHaveLength(2);
  });
});
