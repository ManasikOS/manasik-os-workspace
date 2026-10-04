/**
 * A stable colour for a contact's initials avatar. The same contact always gets the same colour, on every channel,
 * because it is derived only from the contact's name (or phone number), never from the channel or the position in a list.
 */

const CONTACT_AVATAR_COLOR_CLASSES = [
  "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  "bg-lime-100 text-lime-700 dark:bg-lime-950 dark:text-lime-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
] as const;

export function contactAvatarColorClasses(contactKey: string | null | undefined): string {
  const key = (contactKey ?? "").trim().toLowerCase();
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return CONTACT_AVATAR_COLOR_CLASSES[hash % CONTACT_AVATAR_COLOR_CLASSES.length];
}

export function contactAvatarInitials(contactName: string | null | undefined, fallback: string | null | undefined): string {
  const source = (contactName || fallback || "?").replace(/^@/, "");
  const initials = source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "?";
}
