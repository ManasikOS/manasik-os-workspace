/**
 * A small, dependency-free string hash (FNV-1a) shared by every change
 * detector in the agent kernel — snapshot fingerprints (D9) and proposal
 * dependency hashes (D6) alike. This is a change detector, not a security
 * boundary, so a cryptographic hash would be spending cycles nobody needs.
 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** `hashString(JSON.stringify(value))` — the shape every call site here actually wants. */
export function hashObject(value: unknown): string {
  return hashString(JSON.stringify(value));
}
