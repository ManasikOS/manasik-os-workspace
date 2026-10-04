import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("FIX1 provider contact boundary", () => {
  it.each([
    "lib/inbox/outbox/drain.ts",
    "lib/agent/whatsapp/reply-delivery.ts",
  ])("authorizes immediately before sendReply in %s", (path) => {
    const source = readFileSync(path, "utf8");
    const authorizeAt = source.lastIndexOf("authorizeProviderSend");
    const sendAt = source.lastIndexOf("adapter.sendReply");
    expect(authorizeAt).toBeGreaterThan(0);
    expect(sendAt).toBeGreaterThan(authorizeAt);
    expect(source.slice(authorizeAt, sendAt)).not.toMatch(/\.from\(|\.rpc\(/);
  });
});
