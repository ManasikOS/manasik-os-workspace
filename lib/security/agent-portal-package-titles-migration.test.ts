import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { listPortalAllocations } from "@/lib/data/agent-portal-repository";

/**
 * TASK-043 Phase 1, step 5 (PKG-06). The behavioural proof lives in supabase/tests/database/agent_portal_package_titles.test.sql and needs a database.
 * These checks run in the normal suite: the migration exposes only id and title, drops the agent's table policy, and the repository no longer embeds packages.
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/20270120090500_agent_portal_package_titles.sql"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/^\s*--.*$/gm, "");

describe("agent portal package titles migration", () => {
  const start = sql.indexOf("create or replace function public.agent_allocated_package_titles()");
  const body = sql.slice(start, sql.indexOf("$$;", sql.indexOf("as $$", start)));

  it("returns only the package id and title", () => {
    expect(body).toContain("returns table (package_id uuid, title text)");
    expect(body).toContain("select a.package_id, p.title");
    expect(body).not.toMatch(/p\.\*|select \*/);
  });

  it("is limited to the calling agent's own allocations, in the same agency, and is security definer with a fixed search_path", () => {
    expect(body).toContain("a.sales_agent_id = public.current_portal_agent_id()");
    expect(body).toContain("p.agency_id = a.agency_id");
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path = public/);
  });

  it("is not executable by anon or PUBLIC", () => {
    expect(sql).toMatch(/revoke all on function public\.agent_allocated_package_titles\(\) from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.agent_allocated_package_titles\(\) to authenticated/);
  });

  it("drops the agent's direct read of packages and touches no staff policy", () => {
    expect(sql).toMatch(/drop policy if exists "agent read allocated packages" on public\.packages/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/staff (read|insert|update|delete) packages/);
  });
});

describe("listPortalAllocations", () => {
  it("reads the title from the function and never embeds a package", async () => {
    const select = vi.fn(() => ({
      eq: async () => ({
        data: [
          { id: "alloc-1", sales_agent_id: "agent-1", package_id: "pkg-1", allocated_seats: 5 },
          { id: "alloc-2", sales_agent_id: "agent-1", package_id: "pkg-2", allocated_seats: 3 },
        ],
        error: null,
      }),
    }));
    const rpc = vi.fn(async () => ({ data: [{ package_id: "pkg-1", title: "Ramadan Umrah" }], error: null }));
    const from = vi.fn(() => ({ select }));

    const result = await listPortalAllocations({ from, rpc } as never, "agent-1");

    expect(from).toHaveBeenCalledWith("agent_package_allocations");
    expect(select).toHaveBeenCalledWith("*");
    expect(rpc).toHaveBeenCalledWith("agent_allocated_package_titles");
    expect(result.map((row) => [row.package_id, row.packageTitle])).toEqual([
      ["pkg-1", "Ramadan Umrah"],
      ["pkg-2", "—"],
    ]);
  });

  it("fails loudly when the function errors, instead of showing blank titles", async () => {
    const from = () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) });
    const rpc = async () => ({ data: null, error: { code: "42501", message: "denied" } });
    await expect(listPortalAllocations({ from, rpc } as never, "agent-1")).rejects.toThrow();
  });
});
