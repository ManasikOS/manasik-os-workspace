import { describe, expect, it } from "vitest";
import { assessDkim, assessDmarc, assessSpf } from "./domain-authentication";
describe("domain authentication assessment", () => {
  it("distinguishes a valid SPF record from missing and multiple records", () => { expect(assessSpf(["v=spf1 include:_spf.example.test -all"])).toBe("PASS"); expect(assessSpf([])).toBe("MISSING"); expect(assessSpf(["v=spf1 -all", "v=spf1 ~all"])).toBe("MULTIPLE_SPF"); });
  it("keeps temporary DNS failure separate from an absent DNS record at the resolver boundary", () => { expect(assessDmarc([])).toBe("MISSING"); expect(assessDmarc(["v=DMARC1; p=reject"])).toBe("PASS"); });
  it("reports an absent DKIM record and selector mismatch without guessing", () => { expect(assessDkim([], "selector1")).toBe("MISSING"); expect(assessDkim(["v=DKIM1; p=key"], "")).toBe("SELECTOR_MISMATCH"); });
});
