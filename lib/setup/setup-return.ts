import { createHmac, timingSafeEqual } from "node:crypto";

import type { ConnectorId } from "./connector-availability";

/**
 * "Return to setup" for connector round-trips (docs/onboarding/plan.md D9).
 *
 * A connect started from the guided setup drops a short-lived signed cookie;
 * the OAuth callback that finishes the round-trip checks it and, if valid,
 * sends the owner back to /setup instead of Settings. A connect started from
 * Settings sets no cookie and behaves exactly as before.
 *
 * The token is bound to the user and to one provider and expires after 15
 * minutes, and the URL builder below can only ever produce a /setup URL — so
 * the cookie can never be used as an open redirect.
 */

export const SETUP_RETURN_COOKIE = "rf.setup_return";
export const SETUP_RETURN_TTL_SECONDS = 15 * 60;

interface TokenBinding {
  userId: string;
  provider: ConnectorId;
  secret: string;
  /** Milliseconds since epoch; injectable for tests. */
  now?: number;
}

function sign(input: { userId: string; provider: string; expiresAtMs: number; secret: string }): string {
  return createHmac("sha256", input.secret)
    .update(`setup-return:${input.userId}:${input.provider}:${input.expiresAtMs}`)
    .digest("hex")
    .slice(0, 32);
}

export function createSetupReturnToken(binding: TokenBinding): string {
  if (!binding.secret) throw new Error("A signing secret is required to create a setup return token.");
  const expiresAtMs = (binding.now ?? Date.now()) + SETUP_RETURN_TTL_SECONDS * 1000;
  return `${expiresAtMs}.${binding.provider}.${sign({ ...binding, expiresAtMs })}`;
}

export function verifySetupReturnToken(token: string, binding: TokenBinding): boolean {
  if (!binding.secret || !token) return false;

  const [expRaw, provider, signature, ...rest] = token.split(".");
  const expiresAtMs = Number(expRaw);
  if (rest.length > 0 || !signature || !Number.isFinite(expiresAtMs) || provider !== binding.provider) return false;
  if (expiresAtMs <= (binding.now ?? Date.now())) return false;

  const expected = Buffer.from(sign({ userId: binding.userId, provider, expiresAtMs, secret: binding.secret }));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Where a finished connector round-trip goes when it started from setup. Only ever /setup. */
export function resolveConnectorReturnUrl(input: {
  origin: string;
  provider: ConnectorId;
  status: "connected" | "error";
  message: string;
}): string {
  const url = new URL("/setup", input.origin);
  url.searchParams.set("step", "channels");
  if (input.status === "connected") {
    url.searchParams.set("connected", input.provider);
  } else {
    url.searchParams.set("connector_error", input.provider);
    url.searchParams.set("message", input.message.slice(0, 200));
  }
  return url.toString();
}
