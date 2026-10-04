import { describe, expect, it } from "vitest";

import { AUTONOMY_LEVELS } from "@/lib/inbox/risk/never-promise";

import { AUTONOMY_LEVEL_COPY, autonomyLevelName } from "./labels";

describe("autonomy level copy", () => {
  it("describes every level", () => {
    for (const level of AUTONOMY_LEVELS) {
      expect(AUTONOMY_LEVEL_COPY[level].name.length).toBeGreaterThan(3);
      expect(AUTONOMY_LEVEL_COPY[level].description.length).toBeGreaterThan(20);
    }
  });

  it("keeps internal terms out of what an administrator reads", () => {
    for (const level of AUTONOMY_LEVELS) {
      const text = `${AUTONOMY_LEVEL_COPY[level].name} ${AUTONOMY_LEVEL_COPY[level].description}`;
      expect(text).not.toMatch(/\bL[0-3]\b|shadow|propose|surface|pipeline|promotion/i);
    }
  });

  it("gives each level its own name", () => {
    expect(new Set(AUTONOMY_LEVELS.map((level) => autonomyLevelName(level))).size).toBe(AUTONOMY_LEVELS.length);
  });

  it("makes the difference between never sending and sending clear", () => {
    expect(AUTONOMY_LEVEL_COPY.L0.description).toContain("never sends a reply on its own");
    expect(AUTONOMY_LEVEL_COPY.L1.description).toContain("staff to check and send");
  });
});
