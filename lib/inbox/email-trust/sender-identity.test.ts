import { describe, expect, it } from "vitest";
import { createSenderAliasVerification, senderAliasVerificationMatches, senderAliasVerificationSubject, verifySenderAliasToken } from "./sender-identity";
describe("sender alias verification", () => {
  it("accepts the issued token before its expiry", () => { const issued = createSenderAliasVerification(new Date("2026-09-28T00:00:00Z")); expect(verifySenderAliasToken({ ...issued, usedAt: null }, new Date("2026-09-28T00:01:00Z"))).toBe("VERIFIED"); });
  it("rejects expired and replayed tokens", () => { const issued = createSenderAliasVerification(new Date("2026-09-28T00:00:00Z")); expect(verifySenderAliasToken({ ...issued, usedAt: null }, new Date("2026-09-28T00:16:00Z"))).toBe("EXPIRED"); expect(verifySenderAliasToken({ ...issued, usedAt: new Date() })).toBe("REPLAYED"); });
  it("only accepts a matching IMAP message subject", () => { const issued = createSenderAliasVerification(); expect(senderAliasVerificationMatches({ ...issued, usedAt: null, subject: senderAliasVerificationSubject(issued.token) })).toBe("VERIFIED"); expect(senderAliasVerificationMatches({ ...issued, usedAt: null, subject: "unrelated" })).toBe("INVALID"); });
});
