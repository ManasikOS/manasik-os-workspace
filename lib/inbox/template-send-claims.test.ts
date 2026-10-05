import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { attachTemplateConversation, claimRefusalMessage, claimTemplateSend, recordTemplateFailed, recordTemplateSent, STALE_SENDING_MS } from "./template-send-claims";
import { createFakeClaimsAdmin } from "./template-send-claims-fake";

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STAFF = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const claim = (admin: ReturnType<typeof createFakeClaimsAdmin>["admin"], now?: Date) => claimTemplateSend(admin, { agencyId: AGENCY, key: KEY, staffId: STAFF, now });

describe("claimTemplateSend", () => {
  it("lets the first request through and stops the second while the first is running", async () => {
    const { admin } = createFakeClaimsAdmin();
    expect(await claim(admin)).toEqual({ kind: "CLAIMED" });
    expect(await claim(admin)).toEqual({ kind: "IN_PROGRESS" });
  });

  it("answers a repeat of a finished send with the first result, and never lets it send again", async () => {
    const { admin } = createFakeClaimsAdmin();
    await claim(admin);
    await recordTemplateSent(admin, { agencyId: AGENCY, key: KEY, externalMessageId: "wamid.1" });
    expect(await claim(admin)).toEqual({ kind: "ALREADY_SENT", conversationId: null });
    await attachTemplateConversation(admin, { agencyId: AGENCY, key: KEY, conversationId: "conv-1" });
    expect(await claim(admin)).toEqual({ kind: "ALREADY_SENT", conversationId: "conv-1" });
  });

  it("lets a send that failed before reaching the customer be tried again with the same key, by one request only", async () => {
    const { admin } = createFakeClaimsAdmin();
    await claim(admin);
    await recordTemplateFailed(admin, { agencyId: AGENCY, key: KEY, error: "That template is no longer approved." });
    expect(await claim(admin)).toEqual({ kind: "CLAIMED" });
    expect(await claim(admin)).toEqual({ kind: "IN_PROGRESS" });
  });

  it("does not treat a send that has been 'in progress' for minutes as sent or as safe to repeat", async () => {
    const { admin, rows } = createFakeClaimsAdmin();
    await claim(admin);
    const later = new Date(Date.parse([...rows.values()][0].updated_at) + STALE_SENDING_MS + 1000);
    expect(await claim(admin, later)).toEqual({ kind: "UNCERTAIN" });
  });

  it("sends nothing when the attempt cannot be recorded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = createFakeClaimsAdmin({ failInsertWith: { code: "08006", message: "connection lost" } });
    expect(await claim(admin)).toEqual({ kind: "UNAVAILABLE" });
  });

  it("keeps one agency's key apart from another's", async () => {
    const { admin } = createFakeClaimsAdmin();
    await claim(admin);
    expect(await claimTemplateSend(admin, { agencyId: "99999999-9999-4999-8999-999999999999", key: KEY, staffId: STAFF })).toEqual({ kind: "CLAIMED" });
  });
});

describe("claimRefusalMessage", () => {
  it("lets a new claim and a finished repeat through, and explains every refusal in plain words", () => {
    expect(claimRefusalMessage({ kind: "CLAIMED" })).toBeNull();
    expect(claimRefusalMessage({ kind: "ALREADY_SENT", conversationId: null })).toBeNull();
    for (const kind of ["IN_PROGRESS", "UNCERTAIN", "UNAVAILABLE"] as const) expect(claimRefusalMessage({ kind })).toMatch(/\S{3,}/);
  });
});
