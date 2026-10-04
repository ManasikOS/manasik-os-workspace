import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface SenderAliasVerification { token: string; tokenHash: string; expiresAt: Date; }
export function createSenderAliasVerification(now = new Date()): SenderAliasVerification {
  const token = randomBytes(24).toString("base64url");
  return { token, tokenHash: hashSenderAliasToken(token), expiresAt: new Date(now.getTime() + 15 * 60_000) };
}
export function hashSenderAliasToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function verifySenderAliasToken(input: { token: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }, now = new Date()): "VERIFIED" | "EXPIRED" | "REPLAYED" | "INVALID" {
  if (input.usedAt) return "REPLAYED";
  if (input.expiresAt <= now) return "EXPIRED";
  const expected = Buffer.from(input.tokenHash, "hex"); const actual = Buffer.from(hashSenderAliasToken(input.token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? "VERIFIED" : "INVALID";
}

export function senderAliasVerificationSubject(token: string): string { return `CRM sender verification ${token}`; }
export function senderAliasVerificationMatches(input: { subject: string | null | undefined; token: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }, now = new Date()): "VERIFIED" | "EXPIRED" | "REPLAYED" | "INVALID" {
  return input.subject?.trim() === senderAliasVerificationSubject(input.token) ? verifySenderAliasToken(input, now) : "INVALID";
}
