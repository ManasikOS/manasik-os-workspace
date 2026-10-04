import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listMessages } from "@/lib/data/whatsapp-repository";

/** A stand-in for the query builder that applies order + limit the way Postgres would. */
function fakeDb(rows: Array<{ id: number; created_at: string }>) {
  let ascending = true;
  let max = Infinity;
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: (_column: string, options: { ascending: boolean }) => {
      ascending = options.ascending;
      return builder;
    },
    limit: (count: number) => {
      max = count;
      return builder;
    },
    then: (resolve: (value: unknown) => void) => {
      const sorted = [...rows].sort((a, b) => (ascending ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
      resolve({ data: sorted.slice(0, max), error: null });
    },
  };
  return { from: () => builder } as never;
}

describe("listMessages", () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, created_at: `2026-09-18T10:${String(index).padStart(2, "0")}:00Z` }));

  it("returns the newest messages, oldest first, once a conversation is longer than the limit", async () => {
    const result = await listMessages(fakeDb(rows), "conversation-1", 20);
    expect(result).toHaveLength(20);
    expect((result[0] as unknown as { id: number }).id).toBe(11);
    expect((result[19] as unknown as { id: number }).id).toBe(30);
  });

  it("returns a short conversation whole and in order", async () => {
    const result = await listMessages(fakeDb(rows.slice(0, 3)), "conversation-1", 20);
    expect(result.map((row) => (row as unknown as { id: number }).id)).toEqual([1, 2, 3]);
  });
});
