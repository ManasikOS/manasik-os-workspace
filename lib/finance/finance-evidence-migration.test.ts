import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261220090000_finance_evidence_intake.sql"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("FIN-01 Finance evidence intake migration", () => {
  it("creates an agency-scoped evidence record separate from payment truth", () => {
    expect(sql).toContain("create table public.finance_evidence_intake");
    expect(sql).toMatch(/agency_id uuid not null default public\.current_agency_id\(\)/);
    expect(sql).toMatch(/status text not null default 'PENDING_REVIEW'/);
    expect(sql).toMatch(/check \(status in \('PENDING_REVIEW','MATCHED_TO_PAYMENT','DISMISSED'\)\)/);
    expect(sql).toMatch(/payment_id uuid/);
    expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.payments/i);
    expect(sql).not.toMatch(/payment_status/);
  });

  it("uses composite agency foreign keys for every tenant-owned reference", () => {
    for (const target of [
      "conversations",
      "conversation_messages",
      "message_attachments",
      "message_media_analyses",
      "leads",
      "departure_group_bookings",
      "departure_groups",
      "pilgrims",
      "payments",
    ]) {
      expect(sql).toMatch(new RegExp(`references public\\.${target}\\(id, agency_id\\)`));
    }
  });

  it("defensively exposes every referenced UUID primary key as a composite tenant key", () => {
    for (const target of [
      "conversations",
      "conversation_messages",
      "message_attachments",
      "message_media_analyses",
      "leads",
      "departure_group_bookings",
      "departure_groups",
      "pilgrims",
      "payments",
    ]) {
      expect(sql).toMatch(
        new RegExp(`create unique index if not exists ${target}_id_agency_unique\\s+on public\\.${target} \\(id, agency_id\\)`),
      );
    }
  });

  it("makes attachment promotion idempotent and indexes agency-first review paths", () => {
    expect(sql).toContain("unique (agency_id, source_attachment_id)");
    expect(sql).toMatch(
      /finance_evidence_intake_agency_status_created_idx\s+on public\.finance_evidence_intake \(agency_id, status, created_at desc\)/,
    );
    expect(sql).toMatch(
      /finance_evidence_intake_agency_conversation_idx\s+on public\.finance_evidence_intake \(agency_id, source_conversation_id, created_at desc\)/,
    );
  });

  it("records Inbox-policy expiry and lets a legal hold override retention", () => {
    expect(sql).toMatch(/retention_expires_at timestamptz not null/);
    expect(sql).toMatch(/legal_hold_at timestamptz/);
    expect(sql).toMatch(/legal_hold_reason text/);
    expect(sql).toMatch(/finance_evidence_intake_legal_hold_check/);
  });

  it("enables least-privilege RLS with agency and Finance-role checks", () => {
    expect(sql).toContain("alter table public.finance_evidence_intake enable row level security;");
    expect(sql).toContain("revoke all on table public.finance_evidence_intake from anon, authenticated;");
    expect(sql).toContain("grant select, insert, update on table public.finance_evidence_intake to authenticated;");
    expect(sql).not.toMatch(/grant delete on table public\.finance_evidence_intake/);

    expect(sql).toMatch(/create policy finance_evidence_intake_select[\s\S]+?agency_id = \(select public\.current_agency_id\(\)\)[\s\S]+?staff_role_in\('ADMIN','CEO','FINANCE'\)/);
    expect(sql).toMatch(/create policy finance_evidence_intake_insert[\s\S]+?with check[\s\S]+?agency_id = \(select public\.current_agency_id\(\)\)[\s\S]+?staff_role_in\('ADMIN','FINANCE'\)/);
    expect(sql).toMatch(/create policy finance_evidence_intake_update[\s\S]+?using[\s\S]+?with check/);
  });

  it("keeps payment proofs private and agency-prefixed", () => {
    expect(sql).toMatch(/insert into storage\.buckets[\s\S]+?'payment-proofs'[\s\S]+?false/);
    expect(sql).toMatch(/on conflict \(id\) do update[\s\S]+?public = false/);
    expect(sql).toMatch(/bucket_id = 'payment-proofs'/);
    expect(sql).toMatch(/\(storage\.foldername\(name\)\)\[1\] = \(select public\.current_agency_id\(\)\)::text/);
  });
});
