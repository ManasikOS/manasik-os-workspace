import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { makeDeletionConfirmationCode, parseSignedRequest, readDeletionConfirmationCode } from "./signed-request";

const SECRET = "app-secret-1";
const b64url = (buffer: Buffer | string) => Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function sign(payload: unknown, secret = SECRET): string {
  const encodedPayload = b64url(JSON.stringify(payload));
  const signature = b64url(createHmac("sha256", secret).update(encodedPayload).digest());
  return `${signature}.${encodedPayload}`;
}

const valid = { algorithm: "HMAC-SHA256", user_id: "1234567890", issued_at: 1_700_000_000 };

describe("parseSignedRequest", () => {
  it("reads the user id from a correctly signed request", () => {
    expect(parseSignedRequest(sign(valid), [SECRET])).toEqual({ algorithm: "HMAC-SHA256", user_id: "1234567890", issued_at: 1_700_000_000 });
  });

  it("refuses a request signed with another secret", () => {
    expect(parseSignedRequest(sign(valid, "someone-elses"), [SECRET])).toBeNull();
  });

  it("refuses a payload changed after signing", () => {
    const [signature] = sign(valid).split(".");
    const forged = `${signature}.${b64url(JSON.stringify({ ...valid, user_id: "999" }))}`;
    expect(parseSignedRequest(forged, [SECRET])).toBeNull();
  });

  it("accepts a request signed by any secret in the list, and never verifies with an empty secret", () => {
    expect(parseSignedRequest(sign(valid, "second"), ["first", "second"])).not.toBeNull();
    expect(parseSignedRequest(sign(valid, ""), [""])).toBeNull();
    expect(parseSignedRequest(sign(valid), [])).toBeNull();
  });

  it("refuses anything that is not two non-empty parts", () => {
    for (const bad of [null, undefined, "", "abc", "a.b.c", ".payload", "signature.", "not base64 at all"]) expect(parseSignedRequest(bad, [SECRET])).toBeNull();
  });

  it("refuses a correctly signed request with the wrong algorithm or no user", () => {
    expect(parseSignedRequest(sign({ ...valid, algorithm: "HMAC-SHA1" }), [SECRET])).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256" }), [SECRET])).toBeNull();
    expect(parseSignedRequest(sign({ ...valid, user_id: "" }), [SECRET])).toBeNull();
    expect(parseSignedRequest(sign({ ...valid, user_id: 12345 }), [SECRET])).toBeNull();
  });

  it("refuses a signed payload that is not JSON", () => {
    const encodedPayload = b64url("not json");
    const signature = b64url(createHmac("sha256", SECRET).update(encodedPayload).digest());
    expect(parseSignedRequest(`${signature}.${encodedPayload}`, [SECRET])).toBeNull();
  });
});

describe("deletion confirmation codes", () => {
  const NOW = new Date("2026-09-19T12:00:00.000Z");

  it("round-trips: a code we issued reads back the time it was issued", () => {
    const code = makeDeletionConfirmationCode(SECRET, NOW);
    expect(readDeletionConfirmationCode(code, SECRET)?.toISOString()).toBe(NOW.toISOString());
  });

  it("does not recognise a code from another secret, an altered code, or an invented one", () => {
    const code = makeDeletionConfirmationCode(SECRET, NOW);
    expect(readDeletionConfirmationCode(code, "other-secret")).toBeNull();
    expect(readDeletionConfirmationCode(code.replace(/.$/, code.endsWith("0") ? "1" : "0"), SECRET)).toBeNull();
    expect(readDeletionConfirmationCode(`${code.split(".")[0]}x.${code.split(".")[1]}`, SECRET)).toBeNull();
    for (const bad of [null, undefined, "", "abc", "x.y", "zz.00000000000000000000000000000000"]) expect(readDeletionConfirmationCode(bad, SECRET)).toBeNull();
  });

  it("recognises nothing when the secret is empty", () => {
    expect(readDeletionConfirmationCode(makeDeletionConfirmationCode("", NOW), "")).toBeNull();
  });

  it("carries no user id — only a time and a signature", () => {
    expect(makeDeletionConfirmationCode(SECRET, NOW)).toMatch(/^[0-9a-z]+\.[0-9a-f]{32}$/);
  });
});
