/**
 * The outbound allow-list (TASK-032 S9): outside production, the app sends only to contacts that have been named.
 *
 * Why: staging is connected to real WhatsApp, Messenger, Instagram and mail accounts, so a test that "sends a reply" can message a real
 * customer. This turns "use test contacts only" from a habit into a guard that every real send passes. It is enforced where the send is
 * authorised (lib/inbox/outbound/authorize-provider-send.ts, which covers the outbox and the AI replies) and at each direct send path
 * (template sends, announcements, the unsupported-file notices and the setup test message). A disposable test agency never reaches a real
 * provider at all (the simulator answers for it), so it is not subject to this list.
 *
 * Rules
 *  - Production (`SENTRY_ENVIRONMENT=production`): no restriction, and the variable is ignored. Setting it in production is reported as a
 *    configuration problem by the go-live gate (G6).
 *  - Any other environment (staging, a preview, local development, or an unnamed one): `INBOX_OUTBOUND_ALLOWLIST` is a comma-separated list
 *    of the recipient ids the app may send to (separated by commas, semicolons or new lines; spaces inside a phone number are fine). EMPTY OR UNSET MEANS SEND TO NOBODY. The single entry `*` is the explicit way to allow everyone.
 *  - Phone numbers are compared by digits only, so `+94 77 123 4567` and `94771234567` are the same; e-mail addresses ignore case; any other
 *    id (a Messenger or Instagram scoped id) is compared as written, ignoring case.
 *
 * Pure: it reads only the environment object it is given.
 */

export const OUTBOUND_ALLOWLIST_VARIABLE = "INBOX_OUTBOUND_ALLOWLIST";

type Env = Record<string, string | undefined>;

export type OutboundPolicy =
  | { restricted: false }
  | { restricted: true; allowEveryone: boolean; recipients: ReadonlySet<string> };

const PHONE_LIKE = /^\+?[\d\s().-]{6,}$/;

/** One form for every spelling of the same recipient. */
export function normalizeRecipient(raw: string): string {
  const value = raw.trim();
  if (value.includes("@")) return value.toLowerCase();
  if (PHONE_LIKE.test(value)) return value.replace(/\D/g, "");
  return value.toLowerCase();
}

export function resolveOutboundPolicy(env: Env = process.env): OutboundPolicy {
  if (env.SENTRY_ENVIRONMENT?.trim().toLowerCase() === "production") return { restricted: false };
  const entries = (env[OUTBOUND_ALLOWLIST_VARIABLE] ?? "")
    .split(/[,;\r\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const allowEveryone = entries.includes("*");
  return { restricted: true, allowEveryone, recipients: new Set(entries.filter((entry) => entry !== "*").map(normalizeRecipient)) };
}

/**
 * The reason a send to this recipient must not happen, or `null` when it may. A missing recipient is refused when the environment is
 * restricted. The reasons never contain the recipient or the list.
 */
export function outboundRecipientRefusal(recipient: string | null | undefined, env: Env = process.env): string | null {
  const policy = resolveOutboundPolicy(env);
  if (!policy.restricted || policy.allowEveryone) return null;
  if (policy.recipients.size === 0) {
    return `This is not the production environment and no test contacts are approved (${OUTBOUND_ALLOWLIST_VARIABLE} is empty), so nothing is sent.`;
  }
  if (!recipient || !policy.recipients.has(normalizeRecipient(recipient))) {
    return "This is not the production environment and it only sends to approved test contacts; this recipient is not one of them.";
  }
  return null;
}
