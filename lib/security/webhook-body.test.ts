import { describe, expect, it } from "vitest";

import { readBoundedWebhookBody } from "./webhook-body";

const post = (body: string, headers: Record<string, string> = {}) => new Request("https://example.test/hook", { method: "POST", body, headers });

describe("readBoundedWebhookBody", () => {
  it("returns a body within the cap", async () => {
    expect(await readBoundedWebhookBody(post("hello"), 10)).toBe("hello");
  });

  it("rejects a body over the cap even when Content-Length is absent or understated", async () => {
    expect(await readBoundedWebhookBody(post("x".repeat(50)), 10)).toBeNull();
    expect(await readBoundedWebhookBody(post("x".repeat(50), { "content-length": "3" }), 10)).toBeNull();
  });

  it("rejects on a declared Content-Length over the cap without needing the body", async () => {
    expect(await readBoundedWebhookBody(post("ok", { "content-length": "999999999" }), 10)).toBeNull();
  });
});
