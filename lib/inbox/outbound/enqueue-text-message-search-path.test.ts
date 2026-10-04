import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260926070345_inbox_text_message_search_path_hardening.sql",
  ),
  "utf8",
).replace(/\r\n/g, "\n");

/** Prevents a caller-controlled schema from being searched by the authenticated send RPC. */
describe("enqueue_inbox_text_message search-path hardening migration", () => {
  const signature = "enqueue_inbox_text_message(uuid, text, uuid)";

  it("pins an empty search path without changing the callable RPC signature", () => {
    expect(sql).toMatch(
      new RegExp(
        `alter function public\\.${signature.replace(/[()]/g, "\\$&")}\\s+set search_path = '';`,
        "i",
      ),
    );
  });

  it("keeps execution unavailable to public and anon while preserving the documented staff caller", () => {
    expect(sql).toContain(
      `revoke all on function public.${signature} from public, anon;`,
    );
    expect(sql).toContain(
      `grant execute on function public.${signature} to authenticated;`,
    );
  });
});
