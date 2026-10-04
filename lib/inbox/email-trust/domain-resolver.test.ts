import { describe, expect, it } from "vitest";
import { inspectDomainAuthentication } from "./domain-resolver";
describe("inspectDomainAuthentication", () => {
  it("normalizes split TXT records and assesses all three DNS controls", async () => {
    const lookup = async (name: string) => name === "example.test" ? [["v=spf1 ", "-all"]] : name.startsWith("s1.") ? [["v=DKIM1; p=key"]] : [["v=DMARC1; p=reject"]];
    await expect(inspectDomainAuthentication({ domain: "Example.Test", dkimSelector: "s1" }, lookup)).resolves.toMatchObject({ spf: "PASS", dkim: "PASS", dmarc: "PASS" });
  });
  it("reports a resolver failure without claiming that DNS is missing", async () => {
    const lookup = async () => { throw new Error("timeout"); };
    await expect(inspectDomainAuthentication({ domain: "example.test", dkimSelector: "s1" }, lookup)).resolves.toMatchObject({ spf: "LOOKUP_FAILED", dkim: "LOOKUP_FAILED", dmarc: "LOOKUP_FAILED" });
  });
});
