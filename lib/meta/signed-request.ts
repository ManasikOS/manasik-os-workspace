/**
 * Meta's `signed_request` — what the deauthorize and data-deletion callbacks POST (form field `signed_request`).
 * Format: `base64url(signature) + "." + base64url(payload JSON)`, the signature being HMAC-SHA256 of the
 * payload part (exactly as it arrived, still encoded) with the app secret. The payload names the Facebook user
 * (`user_id`) who removed the app or asked for deletion.
 *
 * Pure and dependency-free so every way it can be wrong is pinned by a test. Nothing in a signed request is
 * trusted until the signature checks out, and an unsigned or badly signed one is refused, never partly read.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignedRequestPayload {
  algorithm: string;
  user_id: string;
  issued_at?: number;
}

const base64UrlDecode = (value: string): Buffer => Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Returns the payload of a correctly signed request, or null for anything else. */
export function parseSignedRequest(signedRequest: string | null | undefined, appSecrets: string[]): SignedRequestPayload | null {
  if (!signedRequest) return null;
  const parts = signedRequest.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encodedSignature, encodedPayload] = parts;

  const given = base64UrlDecode(encodedSignature);
  // An empty secret must never verify anything: it would let a request signed with nothing pass.
  const verified = appSecrets
    .filter((secret) => secret.trim().length > 0)
    .some((secret) => {
      const expected = createHmac("sha256", secret).update(encodedPayload).digest();
      return expected.length === given.length && timingSafeEqual(expected, given);
    });
  if (!verified) return null;

  let payload: Partial<SignedRequestPayload>;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as Partial<SignedRequestPayload>;
  } catch {
    return null;
  }
  if (typeof payload.algorithm !== "string" || payload.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
  if (typeof payload.user_id !== "string" || payload.user_id.length === 0) return null;
  return { algorithm: payload.algorithm, user_id: payload.user_id, ...(typeof payload.issued_at === "number" ? { issued_at: payload.issued_at } : {}) };
}

/* ── Confirmation codes ───────────────────────────────────────────────────── */

/**
 * The confirmation code returned to Meta for a data-deletion request, and shown on the status page. Stateless:
 * `<time>.<signature of that time>`, signed with the app secret, so the status page can tell a code we issued
 * from an invented one without a table. It carries no personal data — not even the Facebook user id.
 */
export function makeDeletionConfirmationCode(appSecret: string, now: Date): string {
  const issued = now.getTime().toString(36);
  const signature = createHmac("sha256", appSecret).update(`deletion:${issued}`).digest("hex").slice(0, 32);
  return `${issued}.${signature}`;
}

/** When a code we issued was issued, or null when it is not one of ours. */
export function readDeletionConfirmationCode(code: string | null | undefined, appSecret: string): Date | null {
  if (!code || appSecret.trim().length === 0) return null;
  const match = /^([0-9a-z]{1,12})\.([0-9a-f]{32})$/.exec(code);
  if (!match) return null;
  const [, issued, signature] = match;
  const expected = createHmac("sha256", appSecret).update(`deletion:${issued}`).digest("hex").slice(0, 32);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const at = new Date(parseInt(issued, 36));
  return Number.isNaN(at.getTime()) ? null : at;
}
