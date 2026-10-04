import type { ChannelProvider, ProviderIdentity } from "./contracts";

/** Removes display formatting but intentionally does not guess a country code. */
export function normalizePhone(value: string | null | undefined): string | null {
  const normalized = (value ?? "").replace(/\D/g, "");
  return normalized.length >= 8 && normalized.length <= 15 ? normalized : null;
}

/** Email comparison is case-insensitive; preserve a simple canonical string. */
export function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

export interface IdentityLookupKey {
  provider: ChannelProvider;
  externalSubjectId: string;
  normalizedPhone: string | null;
  normalizedEmail: string | null;
}

/**
 * Exact provider identity is always the primary match. Phone/email are
 * secondary candidates only; database resolution must flag multiples for
 * staff review rather than silently merge customers.
 */
export function toIdentityLookupKey(identity: ProviderIdentity): IdentityLookupKey {
  const externalSubjectId = identity.externalSubjectId.trim();
  if (!externalSubjectId) {
    throw new Error("A provider identity requires an external subject ID.");
  }

  return {
    provider: identity.provider,
    externalSubjectId,
    normalizedPhone: normalizePhone(identity.phone),
    normalizedEmail: normalizeEmail(identity.email),
  };
}

