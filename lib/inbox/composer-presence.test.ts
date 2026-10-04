import { describe, expect, it } from "vitest";

import {
  COMPOSER_PRESENCE_TTL_MS,
  activeComposerPresence,
  otherActiveComposer,
} from "./composer-presence";

const NOW = new Date("2026-09-21T10:00:00.000Z");
const presence = (ageMs: number, staffId = "staff-a") => ({
  staffId,
  at: new Date(NOW.getTime() - ageMs).toISOString(),
});

describe("composer presence", () => {
  it("keeps a heartbeat-window claim active", () => {
    expect(activeComposerPresence(presence(COMPOSER_PRESENCE_TTL_MS), NOW)).not.toBeNull();
  });

  it("ignores a stale or future claim so a closed tab never strands a reply", () => {
    expect(activeComposerPresence(presence(COMPOSER_PRESENCE_TTL_MS + 1), NOW)).toBeNull();
    expect(activeComposerPresence({ staffId: "staff-a", at: "2026-09-21T10:00:01.000Z" }, NOW)).toBeNull();
  });

  it("warns only a different staff member", () => {
    expect(otherActiveComposer(presence(1_000), "staff-a", NOW)).toBeNull();
    expect(otherActiveComposer(presence(1_000), "staff-b", NOW)).toMatchObject({ staffId: "staff-a" });
  });
});

import { composerPresenceMessage } from "./composer-presence";

describe("composerPresenceMessage", () => {
  const now = new Date("2026-10-01T09:00:30Z");
  const presence = { staffId: "amina", at: "2026-10-01T09:00:00Z" };

  it("names the colleague who is writing", () => {
    expect(composerPresenceMessage(presence, "me", [{ id: "amina", name: "Amina" }], now)).toBe(
      "Amina is writing a reply. Please coordinate before sending.",
    );
  });

  it("falls back to a generic name, and says nothing about yourself or when nobody is writing", () => {
    expect(composerPresenceMessage(presence, "me", [], now)).toMatch(/^A colleague is writing/);
    expect(composerPresenceMessage(presence, "amina", [], now)).toBeNull();
    expect(composerPresenceMessage(null, "me", [], now)).toBeNull();
  });
});
