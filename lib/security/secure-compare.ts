import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compares two secrets without leaking, through response time, how many leading characters matched. Both sides
 * are hashed first so `timingSafeEqual` always sees equal-length buffers (it throws otherwise, and a length
 * check alone would leak the secret's length). A missing or blank value never matches.
 */
export function secureSecretEquals(received: string | null | undefined, expected: string | null | undefined): boolean {
  if (!received || !expected) return false;
  const receivedDigest = createHash("sha256").update(received, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

/** True when the request carries `Authorization: Bearer <expected>`. */
export function hasValidBearerSecret(authorizationHeader: string | null, expectedSecret: string | undefined): boolean {
  if (!authorizationHeader || !expectedSecret) return false;
  const prefix = "Bearer ";
  if (!authorizationHeader.startsWith(prefix)) return false;
  return secureSecretEquals(authorizationHeader.slice(prefix.length), expectedSecret);
}
