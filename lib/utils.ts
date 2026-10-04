import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * True when `value` is shaped like a Postgres `uuid`. Used to reject a
 * malformed dynamic route param (e.g. `/packages/not-a-real-id`) with a
 * clean 404 before it ever reaches a query — passing it straight to
 * `.eq("id", value)` instead throws a raw Postgres "invalid input syntax
 * for type uuid" error, which surfaces as the route's error boundary
 * rather than a 404. See docs/modules/packages-production-readiness-plan.md,
 * finding E7.
 */
export function isUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}
