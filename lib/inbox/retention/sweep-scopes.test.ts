import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "@/lib/ai/db";
import { FINISHED_JOB_RETENTION_DAYS, FINISHED_JOB_STATUSES } from "./policy";
import { runRetentionSweepForAgency } from "./sweep";

const AGENCY = "0b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const NOW = new Date("2026-09-25T00:00:00.000Z");

const SETTINGS = {
  booking_linked_message_retention_years: 7, enquiry_message_retention_months: 24,
  inbox_attachment_retention_days: 90, voice_audio_retention_days: 180,
  intelligence_retention_months: 24, ai_run_retention_months: 13, webhook_payload_retention_days: 30,
};

interface Recorded { table: string; selected?: string; lt?: [string, unknown]; in?: Array<[string, unknown[]]>; order: string[]; or?: string; deletedBy?: [string, unknown[]] }

/** Records what each table is asked for. `rowsFor` returns the candidate page (once) for a table; every delete reports its row count. */
function recordingDb(rowsFor: Record<string, Array<Record<string, unknown>>> = {}) {
  const recorded: Recorded[] = [];
  const served = new Set<string>();
  const db = {
    from: (table: string) => {
      if (table === "agency_settings") {
        const o: Record<string, unknown> = { select: () => o, eq: () => o, single: () => Promise.resolve({ data: SETTINGS, error: null }) };
        return o;
      }
      if (table === "inbox_retention_cursors") {
        const o: Record<string, unknown> = { select: () => o, eq: () => o, maybeSingle: () => Promise.resolve({ data: null, error: null }), upsert: () => Promise.resolve({ error: null }) };
        return o;
      }
      if (table === "inbox_retention_sweeps") return { insert: () => Promise.resolve({ error: null }) };
      const entry: Recorded = { table, order: [] };
      let deleting = false;
      const o: Record<string, unknown> = {
        select: (columns: string) => { entry.selected = columns; return o; },
        eq: (column: string, value: unknown) => { if (deleting) entry.deletedBy = [column, [value]]; return o; },
        lt: (column: string, value: unknown) => { entry.lt = [column, value]; return o; },
        in: (column: string, values: unknown[]) => { if (deleting) entry.deletedBy = [column, values]; else (entry.in ??= []).push([column, values]); return o; },
        or: (expression: string) => { entry.or = expression; return o; },
        order: (column: string) => { entry.order.push(column); return o; },
        is: () => o, not: () => o, like: () => o, limit: () => o,
        delete: () => { deleting = true; return o; },
        then: (resolve: (value: { data: unknown; error: null; count?: number }) => void) => {
          recorded.push(entry);
          if (deleting) return resolve({ data: null, error: null, count: 1 });
          const rows = served.has(table) ? [] : rowsFor[table] ?? [];
          served.add(table);
          return resolve({ data: rows, error: null });
        },
      };
      return o;
    },
  };
  return { db: db as unknown as Db, recorded };
}

async function sweep(rowsFor: Record<string, Array<Record<string, unknown>>> = {}) {
  const world = recordingDb(rowsFor);
  const summaries = await runRetentionSweepForAgency(world.db, AGENCY, { dryRun: false, now: NOW, batchSize: 50, budgetMs: 10 * 365 * 86_400_000 });
  return { ...world, summaries };
}

const fetchFor = (recorded: Recorded[], table: string) => recorded.find((entry) => entry.selected && entry.table === table);
const daysBefore = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe("retention sweep scopes added by D1", () => {
  it("sweeps every scope, including the four new ones, and reports each", async () => {
    const { summaries } = await sweep();
    expect(summaries.map((summary) => summary.scope)).toEqual(
      expect.arrayContaining(["WEBHOOK_PAYLOADS", "WHATSAPP_WEBHOOK_PAYLOADS", "CHANNEL_JOBS", "AGENT_JOBS", "INTELLIGENCE", "AI_RUNS"]),
    );
  });

  it("orders raw deliveries by received_at, the column that exists (created_at did not, and failed every night)", async () => {
    const { recorded } = await sweep();
    for (const table of ["channel_webhook_events", "whatsapp_webhook_events"]) {
      const entry = fetchFor(recorded, table);
      expect(entry?.selected).toBe("id,received_at");
      expect(entry?.lt).toEqual(["received_at", daysBefore(30)]);
      expect(entry?.order).toEqual(["received_at", "id"]);
    }
  });

  it("keeps finished jobs for 30 days and only ever selects DONE and DEAD", async () => {
    expect(FINISHED_JOB_RETENTION_DAYS).toBe(30);
    expect(FINISHED_JOB_STATUSES).toEqual(["DONE", "DEAD"]);
    const { recorded } = await sweep();
    for (const table of ["channel_jobs", "agent_jobs"]) {
      const entry = fetchFor(recorded, table);
      expect(entry?.lt).toEqual(["created_at", daysBefore(30)]);
      expect(entry?.in).toEqual([["status", ["DONE", "DEAD"]]]);
    }
  });

  it("deletes a candidate page by id inside the agency, and only that page", async () => {
    const { recorded } = await sweep({ channel_jobs: [{ id: "job-1", created_at: daysBefore(40) }, { id: "job-2", created_at: daysBefore(39) }] });
    const deletion = recorded.find((entry) => entry.table === "channel_jobs" && entry.deletedBy);
    expect(deletion?.deletedBy).toEqual(["id", ["job-1", "job-2"]]);
  });

  it("pages and deletes conversation_intelligence by its real key, conversation_id (it has no id column)", async () => {
    const { recorded } = await sweep({ conversation_intelligence: [{ conversation_id: "conv-1", computed_at: daysBefore(800) }] });
    const page = fetchFor(recorded, "conversation_intelligence");
    expect(page?.selected).toBe("conversation_id,computed_at");
    expect(page?.order).toEqual(["computed_at", "conversation_id"]);
    expect(page?.or).toContain("conversation_id.gt.");
    const deletion = recorded.find((entry) => entry.table === "conversation_intelligence" && entry.deletedBy);
    expect(deletion?.deletedBy).toEqual(["conversation_id", ["conv-1"]]);
  });

  it("still leaves agent_runs alone: the sweep documents them as evidence kept with their conversation", async () => {
    const { recorded } = await sweep();
    expect(recorded.some((entry) => entry.table === "agent_runs")).toBe(false);
  });
});

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261204090500_d1_retention_raw_events_and_jobs.sql"), "utf8").replace(/\r\n/g, "\n");

describe("D1 migration content", () => {
  it("indexes only finished jobs, so a queued or running job costs no index entry", () => {
    expect(sql).toContain("on public.channel_jobs (agency_id, created_at, id)\n  where status in ('DONE', 'DEAD');");
    expect(sql).toContain("on public.agent_jobs (agency_id, created_at, id)\n  where status in ('DONE', 'DEAD');");
  });

  it("purges only agency-less raw events, in bounded SKIP LOCKED batches, within the 1 to 90 day platform bound", () => {
    expect(sql.match(/where e\.agency_id is null and e\.received_at </g)).toHaveLength(2);
    expect(sql.match(/for update skip locked/g)).toHaveLength(2);
    expect(sql).toContain("greatest(1, least(coalesce(p_days, 30), 90))");
  });

  it("is service-role only with a pinned search_path and touches nothing but the two raw-event tables", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("grant execute on function public.purge_unattributed_raw_events(integer, integer) to service_role;");
    expect(sql).not.toMatch(/grant execute[^;]*to (public|anon|authenticated)/);
    const code = sql.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/conversation_messages|public\.conversations|channel_jobs\s+e\b|delete from public\.(channel_jobs|agent_jobs|ai_runs)/);
  });
});
