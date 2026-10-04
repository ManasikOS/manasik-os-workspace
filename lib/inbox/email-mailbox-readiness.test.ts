import { describe, expect, it } from "vitest";

import { isInboxEmailMailboxReady } from "./email-mailbox-readiness";

describe("isInboxEmailMailboxReady", () => {
  it("requires a connected mailbox with complete IMAP settings", () => {
    expect(isInboxEmailMailboxReady({
      status: "CONNECTED",
      provider_metadata: { imapHost: "imap.example.com", imapPort: 993, imapSecurity: "TLS" },
    })).toBe(true);
    expect(isInboxEmailMailboxReady({ status: "CONNECTED", provider_metadata: {} })).toBe(false);
    expect(isInboxEmailMailboxReady({
      status: "NOT_CONNECTED",
      provider_metadata: { imapHost: "imap.example.com", imapPort: 993, imapSecurity: "TLS" },
    })).toBe(false);
  });
});
