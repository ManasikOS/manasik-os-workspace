/**
 * The short-lived cookie that carries a "which account do you want?" login between the OAuth callback and the
 * picker on the Integrations screen. It holds the Vault reference of a login token parked while the agency chooses.
 *
 * A bare reference in a cookie is a hole: whoever can set the cookie could name ANY Vault secret and have the
 * server read it. So the value is sealed — `<reference>.<signature>`, the signature covering the reference AND
 * the agency it was issued to, made with the app secret. A forged, altered, expired-and-reused or cross-agency
 * cookie opens to nothing. Pure, so every failure mode is pinned by a test.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const signatureFor = (reference: string, agencyId: string, secret: string) =>
  createHmac("sha256", secret).update(`pending-login:${agencyId}:${reference}`).digest("hex").slice(0, 32);

export function sealPendingRef(reference: string, agencyId: string, secret: string): string {
  if (secret.trim().length === 0) throw new Error("Cannot seal a pending login without the app secret.");
  return `${reference}.${signatureFor(reference, agencyId, secret)}`;
}

/** The Vault reference inside a cookie sealed for THIS agency, or null for anything else. */
export function openPendingRef(cookieValue: string | null | undefined, agencyId: string, secret: string | null | undefined): string | null {
  if (!cookieValue || !secret || secret.trim().length === 0) return null;
  const at = cookieValue.lastIndexOf(".");
  if (at <= 0) return null;
  const reference = cookieValue.slice(0, at);
  const given = cookieValue.slice(at + 1);
  const expected = signatureFor(reference, agencyId, secret);
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
  return reference;
}
