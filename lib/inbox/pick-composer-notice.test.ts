import { describe, expect, it } from "vitest";

import { pickComposerNotice } from "./pick-composer-notice";

const notice = (kind: "ERROR" | "BLOCKED" | "PRESENCE" | "OWNERSHIP") => ({ kind, message: `${kind} text` });

describe("pickComposerNotice", () => {
  it("returns nothing when there is nothing to say", () => {
    expect(pickComposerNotice([])).toEqual({ primary: null, others: [] });
    expect(pickComposerNotice([null, false, undefined, { kind: "ERROR", message: "  " }])).toEqual({ primary: null, others: [] });
  });

  it("puts a failed send first, then a block, then presence, then ownership", () => {
    const result = pickComposerNotice([notice("OWNERSHIP"), notice("PRESENCE"), notice("ERROR"), notice("BLOCKED")]);
    expect(result.primary?.kind).toBe("ERROR");
    expect(result.others.map((other) => other.kind)).toEqual(["BLOCKED", "PRESENCE", "OWNERSHIP"]);
  });

  it("keeps one notice per kind", () => {
    const result = pickComposerNotice([notice("PRESENCE"), { kind: "PRESENCE", message: "again" }]);
    expect(result.primary?.message).toBe("PRESENCE text");
    expect(result.others).toEqual([]);
  });
});
