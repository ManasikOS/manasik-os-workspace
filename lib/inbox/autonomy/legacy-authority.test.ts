import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { legacyAssistantMayAuthorise } from "./level";

const base = { inboxReplySurfaceEnabled: false, source: "GENERATED", legacyAssistantActive: true, inboxReplyEverConfigured: false };

describe("legacyAssistantMayAuthorise", () => {
  it("keeps the older switch as the authority for an agency that never configured the Inbox reply surface", () => {
    expect(legacyAssistantMayAuthorise(base)).toBe(true);
  });

  it("lets an explicit Inbox reply choice win, even when it was set to L0 (stored as disabled)", () => {
    expect(legacyAssistantMayAuthorise({ ...base, inboxReplyEverConfigured: true })).toBe(false);
  });

  it("does not apply once the Inbox reply surface is enabled: it is then the only policy", () => {
    expect(legacyAssistantMayAuthorise({ ...base, inboxReplySurfaceEnabled: true })).toBe(false);
  });

  it("does not apply when the older switch is off", () => {
    expect(legacyAssistantMayAuthorise({ ...base, legacyAssistantActive: false })).toBe(false);
  });

  it("only ever covers ordinary generated replies, never templates, cached answers or intake", () => {
    for (const source of ["APPROVED_TEMPLATE", "APPROVED_ANSWER", "INTAKE_FLOW"]) {
      expect(legacyAssistantMayAuthorise({ ...base, source })).toBe(false);
    }
  });

  it("prevents new production runtime reads from the legacy authority", () => {
    const root = process.cwd();
    const productionFiles: string[] = [];
    const collectTypeScript = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) collectTypeScript(path);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) productionFiles.push(path);
      }
    };
    collectTypeScript(join(root, "lib"));
    collectTypeScript(join(root, "app"));

    const readers = productionFiles
      .filter((path) => readFileSync(path, "utf8").includes("legacyAssistantMayAuthorise"))
      .map((path) => relative(root, path).replaceAll("\\", "/"))
      .sort();

    expect(readers).toEqual([
      "lib/inbox/autonomy/level.ts",
      "lib/inbox/autonomy/runtime.ts",
    ]);
  });
});
