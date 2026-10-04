import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * T13 to T15 (tasks/plan.md): Inngest is removed (decision R9). pg_cron and the Postgres sweep do everything it did. This keeps it that way:
 * nothing may import it, depend on it, serve its route, or call the database objects that only it used.
 */

const root = process.cwd();
const SOURCE_DIRECTORIES = ["app", "lib", "worker", "components", "utils", "scripts"];
const SKIP = new Set(["node_modules", ".next", ".git"]);

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    if (SKIP.has(name)) continue;
    const full = join(directory, name);
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) files.push(full);
  }
  return files;
}

const files = [...SOURCE_DIRECTORIES.flatMap((directory) => sourceFiles(join(root, directory))), join(root, "proxy.ts")].filter(existsSync);
// This guard file names the things it forbids, so it is the one file that may.
const guarded = files.filter((file) => !file.endsWith("no-inngest.test.ts"));

describe("Inngest is gone", () => {
  it("has no Inngest package in package.json", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
    expect(names.filter((name) => /inngest/i.test(name))).toEqual([]);
  });

  it("has no route, library folder or machine-route entry for it", () => {
    expect(existsSync(join(root, "app", "api", "inngest"))).toBe(false);
    expect(existsSync(join(root, "lib", "inbox", "inngest"))).toBe(false);
    expect(readFileSync(join(root, "proxy.ts"), "utf8")).not.toMatch(/api\/inngest/);
  });

  it("imports nothing from Inngest, in the app, the worker or the libraries", () => {
    const offenders = guarded.filter((file) => /(from|import|require\()\s*["'](@inngest\/|inngest["'/]|@\/lib\/inbox\/inngest)/.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => file.slice(root.length + 1))).toEqual([]);
  });

  it("calls none of the database objects that only Inngest used", () => {
    const forbidden = /(enqueue_inngest_event|claim_inngest_outbox|complete_inngest_outbox|fail_inngest_outbox|purge_finished_inngest_outbox|trg_enqueue_window_opened|from\(["']inngest_outbox["']\))/;
    const offenders = guarded.filter((file) => forbidden.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => file.slice(root.length + 1))).toEqual([]);
  });

  it("reads no INNGEST_ environment variable", () => {
    const offenders = guarded.filter((file) => /process\.env\.INNGEST_|["']INNGEST_[A-Z_]+["']/.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => file.slice(root.length + 1))).toEqual([]);
  });

  it("has no INNGEST_ entry left in .env.example", () => {
    expect(readFileSync(join(root, ".env.example"), "utf8")).not.toMatch(/INNGEST_/);
  });
});

describe("the cleanup migration (T15)", () => {
  const sql = readFileSync(join(root, "supabase", "migrations", "20261227090000_drop_inngest_outbox.sql"), "utf8").replace(/^--.*$/gm, "");

  it("drops the three triggers, then their function, then the outbox functions, then the table, in that order", () => {
    const order = [
      "drop trigger if exists conversations_window_opened_on_insert",
      "drop trigger if exists conversations_window_opened_on_window",
      "drop trigger if exists conversations_window_opened_on_handoff",
      "drop function if exists public.trg_enqueue_window_opened()",
      "drop function if exists public.purge_finished_inngest_outbox(integer, integer, integer)",
      "drop function if exists public.complete_inngest_outbox(uuid[])",
      "drop function if exists public.fail_inngest_outbox(uuid, text)",
      "drop function if exists public.claim_inngest_outbox(integer, integer)",
      "drop function if exists public.enqueue_inngest_event(uuid, text, jsonb)",
      "drop table if exists public.inngest_outbox",
    ].map((statement) => sql.indexOf(statement));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("never cascades and drops nothing else", () => {
    expect(sql).not.toMatch(/cascade/i);
    const drops = [...sql.matchAll(/drop (table|function|trigger|policy|index|type|view|column) if exists ([^\s(;]+)/gi)].map((match) => `${match[1].toLowerCase()} ${match[2]}`);
    expect(drops).toEqual([
      "trigger conversations_window_opened_on_insert",
      "trigger conversations_window_opened_on_window",
      "trigger conversations_window_opened_on_handoff",
      "function public.trg_enqueue_window_opened",
      "function public.purge_finished_inngest_outbox",
      "function public.complete_inngest_outbox",
      "function public.fail_inngest_outbox",
      "function public.claim_inngest_outbox",
      "function public.enqueue_inngest_event",
      "table public.inngest_outbox",
    ]);
  });

  it("keeps what the sweep and the housekeeping still use", () => {
    expect(sql).not.toMatch(/conversation_followups|staff_notifications|find_orphan_staged_uploads|find_unreconciled_raw_events|mark_raw_events_reconciled/);
  });
});
