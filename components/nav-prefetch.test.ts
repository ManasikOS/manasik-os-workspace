import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Always-visible navigation links must not prefetch: the pages are force-dynamic, so a viewport prefetch renders each destination's
 * layout on every page view and burns Vercel Active CPU (docs/architecture/vercel-usage-implementation-plan.md, slice 1).
 * Vitest runs here without a DOM, so this reads the source instead of rendering it.
 */
const FILES = [
  "components/app-sidebar.tsx",
  "components/notification-bell.tsx",
  "app/(main)/management/settings/components/settings-nav.tsx",
];

describe("navigation links do not prefetch", () => {
  it.each(FILES)("%s", (file) => {
    const source = readFileSync(path.resolve(__dirname, "..", file), "utf8");
    const links = source.match(/<Link\s[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toContain("prefetch={false}");
  });
});
