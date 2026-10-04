import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { verifyMetaSignature, isValidMetaHandshake } = await import("./signature");

const sign = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

describe("verifyMetaSignature", () => {
  const body = '{"object":"page","entry":[]}';

  it("accepts a correct signature", () => {
    expect(verifyMetaSignature(body, sign(body, "s3cret"), "s3cret")).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifyMetaSignature(body, sign(body, "other"), "s3cret")).toBe(false);
  });

  it("rejects a body that was altered after signing", () => {
    expect(verifyMetaSignature(`${body} `, sign(body, "s3cret"), "s3cret")).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyMetaSignature(body, null, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, "", "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, "sha256=short", "s3cret")).toBe(false);
  });

  it("accepts a signature made by any secret in the list (Instagram app secret vs Meta app secret)", () => {
    expect(verifyMetaSignature(body, sign(body, "instagram"), ["meta", "instagram"])).toBe(true);
    expect(verifyMetaSignature(body, sign(body, "meta"), ["meta", "instagram"])).toBe(true);
  });

  it("rejects when the signing secret is not in the list", () => {
    expect(verifyMetaSignature(body, sign(body, "attacker"), ["meta", "instagram"])).toBe(false);
  });

  it("never verifies when no usable secret is configured — an empty secret must not match an empty-key signature", () => {
    expect(verifyMetaSignature(body, sign(body, ""), "")).toBe(false);
    expect(verifyMetaSignature(body, sign(body, ""), [undefined, ""])).toBe(false);
    expect(verifyMetaSignature(body, sign(body, "x"), [])).toBe(false);
  });
});

describe("isValidMetaHandshake", () => {
  it("accepts subscribe with the matching token and a challenge", () => {
    expect(isValidMetaHandshake({ mode: "subscribe", token: "t", challenge: "abc" }, "t")).toBe(true);
  });

  it("rejects a wrong token, wrong mode, missing challenge, or unconfigured token", () => {
    expect(isValidMetaHandshake({ mode: "subscribe", token: "x", challenge: "abc" }, "t")).toBe(false);
    expect(isValidMetaHandshake({ mode: "unsubscribe", token: "t", challenge: "abc" }, "t")).toBe(false);
    expect(isValidMetaHandshake({ mode: "subscribe", token: "t", challenge: null }, "t")).toBe(false);
    expect(isValidMetaHandshake({ mode: "subscribe", token: "t", challenge: "abc" }, undefined)).toBe(false);
    expect(isValidMetaHandshake({ mode: "subscribe", token: null, challenge: "abc" }, undefined)).toBe(false);
  });
});
