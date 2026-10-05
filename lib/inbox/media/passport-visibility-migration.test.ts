import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STAFF_ROLES } from "@/lib/access/departure-groups-access";

import { canViewPassportMedia } from "./passport-visibility";

/** SEC-3: the database must name the same roles as the screen, and the repository must apply the screen's rule on every path that signs attachments. */
const migration = readFileSync(join(process.cwd(), "supabase/migrations/20270113090000_inbox_passport_media_visibility.sql"), "utf8").replace(/^\s*--.*$/gm, "");
const repository = readFileSync(join(process.cwd(), "lib/data/inbox-repository.ts"), "utf8");
const allowedRoles = STAFF_ROLES.filter((role) => canViewPassportMedia(role)).sort();

function roleListsAfter(text: string): string[][] {
  return [...text.matchAll(/staff_role_in\(((?:'[A-Z]+',?\s*)+)\)/g)].map((match) => [...match[1].matchAll(/'([A-Z]+)'/g)].map((role) => role[1]));
}

describe("passport media visibility migration", () => {
  it("restricts the analyses policy and the storage policy to the roles that may see traveller data", () => {
    const restricted = roleListsAfter(migration).filter((roles) => roles.length === allowedRoles.length);
    expect(restricted.length).toBeGreaterThanOrEqual(2);
    for (const roles of restricted) expect([...roles].sort()).toEqual(allowedRoles);
  });

  it("still lets every Inbox role read the other kinds of file and analysis", () => {
    expect(migration).toMatch(/kind <> 'PASSPORT' or public\.staff_role_in/);
    expect(migration).toMatch(/or not public\.inbox_object_is_passport\(name\)/);
  });

  it("answers 'is this a passport' from a security-definer function that only authenticated users can run", () => {
    expect(migration).toMatch(/function public\.inbox_object_is_passport[\s\S]*security definer[\s\S]*set search_path = ''/);
    expect(migration).toContain("revoke all on function public.inbox_object_is_passport(text) from public, anon;");
  });

  it("is applied by both paths that sign attachments (full load and thread delta)", () => {
    expect(repository.match(/canViewVoiceTranscripts\(role\), canViewPassportMedia\(role\)/g)).toHaveLength(2);
  });
});
