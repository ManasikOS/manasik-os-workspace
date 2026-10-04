import { describe, expect, it } from "vitest";

import { emptyViewCopy } from "./empty-view-copy";
import { INBOX_VIEWS } from "./views";

describe("emptyViewCopy", () => {
  it("has a title and a hint for every view", () => {
    for (const view of INBOX_VIEWS) {
      const copy = emptyViewCopy(view);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.hint.length).toBeGreaterThan(0);
    }
  });
});
