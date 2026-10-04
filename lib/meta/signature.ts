import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { secureSecretEquals } from "@/lib/security/secure-compare";

/**
 * Verifies Meta's `X-Hub-Signature-256` header against the **raw** request body. Must be computed over
 * the exact bytes Meta sent — a body that has been `JSON.parse()`d and re-serialised will not match.
 * Timing-safe comparison so response latency can't be used to guess the signature.
 *
 * `secrets` may be a list: an Instagram-Login app has its own Instagram app secret alongside the Meta
 * app secret, and Meta's docs don't say which signs Instagram webhooks (plan F9). A list lets the
 * Instagram route accept either until that is confirmed — it never means "skip verification". An
 * empty list, a blank secret or a missing header always fails.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  secrets: string | ReadonlyArray<string | undefined>,
): boolean {
  if (!signatureHeader) return false;
  const candidates = (Array.isArray(secrets) ? secrets : [secrets]).filter(
    (secret): secret is string => typeof secret === "string" && secret.length > 0,
  );
  const received = Buffer.from(signatureHeader, "utf8");

  let matched = false;
  for (const secret of candidates) {
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`, "utf8");
    // Every candidate is compared (no early exit) so timing doesn't reveal which secret matched.
    if (expected.length === received.length && timingSafeEqual(expected, received)) matched = true;
  }
  return matched;
}

/** Meta's GET subscription handshake — identical on every object; only the expected token differs. */
export function isValidMetaHandshake(
  params: { mode: string | null; token: string | null; challenge: string | null },
  expectedToken: string | undefined,
): boolean {
  return params.mode === "subscribe" && Boolean(params.token) && Boolean(expectedToken) && secureSecretEquals(params.token, expectedToken) && Boolean(params.challenge);
}
