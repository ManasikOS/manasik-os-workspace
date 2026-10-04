import { describe, expect, it } from "vitest";

import { facts, NOW } from "../fixtures";
import { detectConcurrentComposer } from "./concurrent-composer";

const composing = (minutesAgo: number) => ({ staffId: "3f1d2c4e-5a6b-4c7d-8e9f-0000000000bb", at: new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString() });

describe("CONCURRENT_COMPOSER", () => {
  it("fires while a colleague started writing within two minutes", () => {
    expect(detectConcurrentComposer(facts({ composing: composing(0.5) }))).toMatchObject({ code: "CONCURRENT_COMPOSER", messageId: null });
    expect(detectConcurrentComposer(facts({ composing: composing(2) }))).not.toBeNull();
  });

  it("near-miss: a marker that is a little too old is forgotten, not live", () => {
    expect(detectConcurrentComposer(facts({ composing: composing(2.5) }))).toBeNull();
    expect(detectConcurrentComposer(facts({ composing: composing(600) }))).toBeNull();
  });

  it("a marker from the future (clock skew) does not fire", () => {
    expect(detectConcurrentComposer(facts({ composing: composing(-5) }))).toBeNull();
  });

  it("negative: nobody is composing", () => {
    expect(detectConcurrentComposer(facts())).toBeNull();
  });
});
