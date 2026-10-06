/**
 * Keeps personal contact details out of the activity trail.
 *
 * The trail is append-only and readable by several roles, so a phone number written
 * into it is copied forever and outlives the booking it belonged to. The booking row
 * holds the real number (and can be corrected or erased); the trail only needs to show
 * that a number changed and let someone recognise which.
 */

/** "+94 77 123 4567" -> "••• •• •••• 567": digits hidden, last three kept so a person can still tell numbers apart. */
export function maskPhoneNumber(phone: string | null | undefined): string {
  const value = (phone ?? "").trim();
  if (!value) return "no number";
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 3) return "•••";
  return `••••${digits.slice(-3)}`;
}
