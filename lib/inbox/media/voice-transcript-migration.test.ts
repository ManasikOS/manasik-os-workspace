import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261221090000_inbox_voice_transcripts.sql"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("MED-01 Inbox voice transcript migration", () => {
  it("creates an agency-scoped transcript table keyed to the source attachment and message", () => {
    expect(sql).toContain("create table public.inbox_voice_transcripts");
    expect(sql).toMatch(/agency_id uuid not null default public\.current_agency_id\(\)/);
    expect(sql).toMatch(/foreign key \(attachment_id, agency_id\)\s+references public\.message_attachments\(id, agency_id\)\s+on delete cascade/);
    expect(sql).toMatch(/foreign key \(message_id, agency_id\)\s+references public\.conversation_messages\(id, agency_id\)\s+on delete cascade/);
    for (const target of ["conversation_messages", "message_attachments"]) {
      expect(sql).toMatch(
        new RegExp(`create unique index if not exists ${target}_id_agency_unique\\s+on public\\.${target} \\(id, agency_id\\)`),
      );
    }
  });

  it("records status, language, provider/model, confidence and lifecycle timestamps", () => {
    expect(sql).toMatch(/status text not null default 'PENDING'/);
    expect(sql).toMatch(
      /check \(status in \('PENDING','PROCESSING','COMPLETE','LOW_CONFIDENCE','FAILED','SKIPPED'\)\)/,
    );
    for (const column of [
      "language text",
      "confidence numeric(3,2)",
      "provider text",
      "model text",
      "requested_at timestamptz",
      "started_at timestamptz",
      "completed_at timestamptz",
      "created_at timestamptz",
      "updated_at timestamptz",
    ]) {
      expect(sql).toContain(column);
    }
  });

  it("makes transcription idempotent per voice attachment", () => {
    expect(sql).toMatch(/unique \(agency_id, attachment_id\)/);
    expect(sql).toMatch(/inbox_voice_transcripts_agency_open_idx[\s\S]+?where status in \('PENDING','PROCESSING'\)/);
  });

  it("holds the lifecycle shape: text only for finished transcripts, a reason only for absent ones", () => {
    expect(sql).toMatch(/inbox_voice_transcripts_lifecycle_check/);
    expect(sql).toMatch(/status in \('PENDING','PROCESSING'\)\s+and transcript_text is null and failure_reason is null/);
    expect(sql).toMatch(/status in \('COMPLETE','LOW_CONFIDENCE'\)[\s\S]+?confidence is not null/);
    expect(sql).toMatch(/status in \('FAILED','SKIPPED'\)\s+and transcript_text is null and failure_reason is not null/);
  });

  it("bounds the failure reason to machine codes so it cannot carry transcript content", () => {
    expect(sql).toMatch(/failure_reason text\s+check \(failure_reason is null or failure_reason in \(/);
    expect(sql).toContain("'QUOTA_EXCEEDED'");
    expect(sql).toContain("'UNSUPPORTED_FORMAT'");
    expect(sql).toContain("'PROVIDER_ERROR'");
  });

  it("labels every transcript non-authoritative at the schema level and leaves the customer message untouched", () => {
    expect(sql).toMatch(/non_authoritative boolean not null default true\s+check \(non_authoritative\)/);
    expect(sql).not.toMatch(/alter table public\.conversation_messages/i);
    expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.conversation_messages/i);
    expect(sql).not.toMatch(/alter table public\.message_media_analyses/i);
  });

  it("follows source retention but lets a legal hold block deletion", () => {
    expect(sql).toMatch(/legal_hold_at timestamptz/);
    expect(sql).toMatch(/inbox_voice_transcripts_legal_hold_check/);
    expect(sql).toMatch(/before delete on public\.inbox_voice_transcripts\s+for each row execute function public\.inbox_voice_transcripts_block_held_delete\(\)/);
    expect(sql).toMatch(/if old\.legal_hold_at is not null then\s+raise exception/);
    expect(sql).toMatch(/create or replace function public\.inbox_voice_transcripts_block_held_delete\(\)[\s\S]+?set search_path = ''/);
    expect(sql).toContain("revoke execute on function public.inbox_voice_transcripts_block_held_delete() from public, anon, authenticated;");
  });

  it("enables RLS with a staff-only agency-scoped select and no client write grants", () => {
    expect(sql).toContain("alter table public.inbox_voice_transcripts enable row level security;");
    expect(sql).toContain("revoke all on table public.inbox_voice_transcripts from anon, authenticated;");
    expect(sql).toContain("grant select on table public.inbox_voice_transcripts to authenticated;");
    expect(sql).not.toMatch(/grant (?:insert|update|delete)[^;]*on table public\.inbox_voice_transcripts/i);
    expect(sql).not.toMatch(/create policy inbox_voice_transcripts_(?:insert|update|delete)/);
    expect(sql).toMatch(
      /create policy inbox_voice_transcripts_select[\s\S]+?agency_id = \(select public\.current_agency_id\(\)\)[\s\S]+?staff_role_in\('ADMIN','CEO','MARKETING','OPERATIONS','FINANCE','VISA'\)/,
    );
    // GUIDE is deliberately outside the Inbox roles and must not read transcripts.
    expect(sql).not.toMatch(/staff_role_in\([^)]*'GUIDE'/);
  });
});
