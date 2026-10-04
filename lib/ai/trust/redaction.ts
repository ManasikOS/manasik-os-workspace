/**
 * The shared redaction allowlist — moved out of
 * `lib/agent/kernel/telemetry.ts` (which now re-exports `FORBIDDEN_KEYS`
 * from here) so every surface's Context Pack, tool result and stored tool
 * argument gets the same backstop, not one list per agent. See
 * docs/modules/manasik-intelligence-implementation-plan.md §3.6 (Trust layer).
 *
 * This is a defensive second pass, independent of whichever surface is
 * calling — the underlying data sources are expected to already omit
 * sensitive fields by construction (a pack's own `facts` type, a
 * repository's hand-picked `.select()`). This is the backstop for a future
 * one that forgets to.
 */

/** Field names that must never reach an external surface, a stored tool argument, or a log a customer/supplier could see, wherever they appear. */
export const FORBIDDEN_KEYS = new Set([
  "internal_cost",
  "supplier_cost",
  "margin",
  "supplier_id",
  "passport_number",
  "national_id",
  "medical",
  "medical_notes",
  "payment_schedule",
  "outstanding_balance",
  "amount_paid",
  "staff_email",
  "staff_whatsapp",
]);

/** Deep-redacts every key in `FORBIDDEN_KEYS` from a JSON-shaped value, recursively. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !FORBIDDEN_KEYS.has(key))
        .map(([key, v]) => [key, redact(v)]),
    );
  }
  return value;
}

/**
 * Removes a viewer's un-permitted fields from a Context Pack's `facts`
 * before it ever reaches a model call. `capabilities` is whatever
 * capability map the pack's own module exports (e.g.
 * `DepartureGroupCapabilities`) — this function only removes keys named in
 * `fieldCapabilityMap`, so a pack that names no sensitive fields there is
 * returned unchanged.
 */
export function redactForCapabilities<T extends Record<string, unknown>>(
  facts: T,
  capabilities: Record<string, boolean>,
  fieldCapabilityMap: Partial<Record<keyof T, string>>,
): T {
  const result: Record<string, unknown> = { ...facts };
  for (const [field, capabilityKey] of Object.entries(fieldCapabilityMap)) {
    if (capabilityKey && !capabilities[capabilityKey]) {
      delete result[field];
    }
  }
  return result as T;
}
