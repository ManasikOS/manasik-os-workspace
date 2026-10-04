/**
 * The soft presence lease used by the Inbox composer. This is intentionally
 * not a lock: a closed tab must never strand a customer conversation.
 */

export const COMPOSER_PRESENCE_HEARTBEAT_MS = 60_000;
export const COMPOSER_PRESENCE_TTL_MS = 2 * COMPOSER_PRESENCE_HEARTBEAT_MS;

export interface ComposerPresence {
  staffId: string;
  at: string;
}

/** A future timestamp is not trusted as active; it can be a client clock error. */
export function activeComposerPresence(
  presence: ComposerPresence | null,
  now: Date,
): ComposerPresence | null {
  if (!presence) return null;
  const touchedAt = Date.parse(presence.at);
  if (Number.isNaN(touchedAt)) return null;
  const age = now.getTime() - touchedAt;
  return age >= 0 && age <= COMPOSER_PRESENCE_TTL_MS ? presence : null;
}

/** The warning is deliberately absent for the person holding the soft lease. */
export function otherActiveComposer(
  presence: ComposerPresence | null,
  currentStaffId: string | null,
  now: Date,
): ComposerPresence | null {
  const active = activeComposerPresence(presence, now);
  return active && active.staffId !== currentStaffId ? active : null;
}

/** The sentence shown when a colleague is writing in the same chat, or null when nobody else is. */
export function composerPresenceMessage(
  presence: ComposerPresence | null,
  currentStaffId: string | null,
  staff: ReadonlyArray<{ id: string; name: string }>,
  now: Date,
): string | null {
  const other = otherActiveComposer(presence, currentStaffId, now);
  if (!other) return null;
  const name = staff.find((person) => person.id === other.staffId)?.name ?? "A colleague";
  return `${name} is writing a reply. Please coordinate before sending.`;
}
