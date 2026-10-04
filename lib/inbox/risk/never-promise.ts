/**
 * The never-autonomous list — MI4.2 of docs/inbox/implementation-plan.md (Architecture §10.3). In code, not configuration.
 *
 * Eleven things an automated reply must never say, at ANY autonomy level. It is a constant with a test asserting every entry
 * is refused at every level, because a deny list an administrator can clear is not a deny list. `findNeverPromise` is the
 * middle of three layers (the prompt is the weakest, the outbound send gate the strongest): it reads the words of a draft.
 *
 * It is a phrase matcher, not a judge of meaning. It errs toward refusing: a draft it refuses is withheld for a person to
 * write, which costs a minute; a draft it lets through that promises a refund costs a customer's trust. A person may still say
 * any of these — this list is about what an automated reply may say, and a person is held to the open-review gate instead.
 */

import { AUTONOMY_LEVELS, type AutonomyLevel } from "@/lib/inbox/intelligence/contracts";

/** The ladder is defined in `contracts.ts`; it is re-exported here because this list is proved unreachable at every level. */
export { AUTONOMY_LEVELS };
export type { AutonomyLevel };

export const NEVER_AUTONOMOUS_IDS = [
  "CONFIRM_PAYMENT",
  "PROMISE_VISA_APPROVAL",
  "GRANT_DISCOUNT",
  "CONFIRM_UNAVAILABLE_INVENTORY",
  "MATERIAL_BOOKING_CHANGE",
  "SEND_UNAPPROVED_BANK_DETAILS",
  "COMMIT_REFUND_OR_CANCELLATION",
  "RELIGIOUS_RULING",
  "HEALTH_OR_SAFETY_ADVICE",
  "CLOSE_COMPLAINT",
  "MARKETING_BROADCAST",
] as const;
export type NeverAutonomousId = (typeof NEVER_AUTONOMOUS_IDS)[number];

export interface NeverAutonomousEntry {
  id: NeverAutonomousId;
  /** In words a person reads when a draft is withheld. */
  label: string;
  /** Phrases that make a draft say it. Matched on lower-cased text with accents and extra spaces removed. */
  patterns: readonly RegExp[];
}

export const NEVER_AUTONOMOUS: readonly NeverAutonomousEntry[] = [
  {
    id: "CONFIRM_PAYMENT",
    label: "confirm that a payment was received",
    patterns: [
      /\b(we|i)( have|'ve)? (received|got|confirmed) (your|the) (payment|transfer|deposit|advance|money|slip)\b/,
      /\b(your|the) (payment|transfer|deposit|advance|slip) (is|has been|was|have been) (confirmed|received|verified|successful|credited|approved)\b/,
      /\bpayment (confirmed|received|verified|successful)\b/,
      /\bthank(s| you) for (the |your )?payment\b.*\b(received|confirmed)\b/,
    ],
  },
  {
    id: "PROMISE_VISA_APPROVAL",
    label: "promise that a visa will be approved",
    patterns: [
      /\b(your |the )?visa (will|is going to|is sure to|is certain to) (be )?(approved|granted|issued|get approved)\b/,
      /\b(guarantee|guaranteed|assure|assured|promise)\b.{0,40}\bvisa\b/,
      /\bvisa\b.{0,40}\b(guaranteed|100%|for sure|definitely|without (any )?(problem|issue|fail))\b/,
    ],
  },
  {
    id: "GRANT_DISCOUNT",
    label: "offer or grant a discount",
    patterns: [
      /\b(give|giving|offer|offering|allow|grant|granting) (you )?(a |an |the |some )?(special |extra |additional |group |early[- ]bird )?(discount|reduction|concession|rebate)\b/,
      /\b\d{1,2}\s?% (off|discount|less)\b/,
      /\b(reduce|lower|drop|cut|waive)( the| your)? (price|rate|fee|charge|cost|amount)\b/,
      /\bspecial (price|rate|deal) (just )?for you\b/,
    ],
  },
  {
    id: "CONFIRM_UNAVAILABLE_INVENTORY",
    label: "guarantee or hold seats or rooms",
    patterns: [
      /\b(your )?(seats?|rooms?|places?|spots?) (is|are|will be|have been|has been) (guaranteed|confirmed|reserved|held|secured|blocked)\b/,
      /\b(we|i)( have|'ve| will|'ll)? (guarantee|guaranteed|reserve|reserved|hold|held|secure|secured|block|blocked) (your |the |these |those )?(seats?|rooms?|places?|spots?)\b/,
      /\bseats? (are )?(still )?available for sure\b/,
    ],
  },
  {
    id: "MATERIAL_BOOKING_CHANGE",
    label: "change or move a booking",
    patterns: [
      /\b(we|i)( have|'ve)? (changed|moved|transferred|swapped|upgraded|downgraded|amended|updated) (your|the) (booking|reservation|package|departure|room|flight)\b/,
      /\b(your|the) (booking|reservation|package|departure) (has been|was|is now) (changed|moved|transferred|swapped|amended|upgraded|cancelled|canceled)\b/,
    ],
  },
  {
    id: "SEND_UNAPPROVED_BANK_DETAILS",
    label: "give bank details that are not on the approved list",
    // Number-based: decided by `findNeverPromise` against the approved list, not by a phrase.
    patterns: [],
  },
  {
    id: "COMMIT_REFUND_OR_CANCELLATION",
    label: "promise a refund or a free cancellation",
    patterns: [
      /\b(we|i)( will|'ll| can|'ll be able to)? (refund|reimburse|return) (you|your|the|all|full)\b/,
      /\b(you (will|'ll) (get|receive) (a |your |the )?(full |complete )?(refund|money back))\b/,
      /\b(full|complete|100%) refund\b/,
      /\b(refund|money back) (is|has been|will be) (approved|processed|issued|guaranteed|initiated)\b/,
      /\b(free|no[- ]charge|no[- ]fee) cancell?ation\b/,
      /\bcancell?ation (is|will be|would be) (free|waived|at no charge|without (any )?charge)\b/,
      /\bwe (will|can|have) cancel(led)? (your|the) (booking|reservation|package)\b/,
    ],
  },
  {
    id: "RELIGIOUS_RULING",
    label: "give a religious ruling",
    patterns: [
      /\b(it is|it's|that is|that's|this is) (permissible|impermissible|halal|haram|makruh|mustahabb|wajib|fard|sinful|allowed in islam|not allowed in islam)\b/,
      /\b(fatwa|fatwah)\b/,
      /\byou (must|need to|have to) (pay|offer|give|perform|slaughter) (a )?(dam|damm|fidyah|fidya|kaffarah|kaffara|sacrifice)\b/,
      /\byour (umrah|hajj|ihram|tawaf|sai|prayer|fast) (is|will be|would be) (valid|invalid|void|accepted|not accepted|broken)\b/,
    ],
  },
  {
    id: "HEALTH_OR_SAFETY_ADVICE",
    label: "give health or safety advice",
    patterns: [
      /\b(you )?(should|must|need to|can) (take|stop taking|skip|increase|reduce|avoid) (your )?(medicine|medication|tablets?|pills?|insulin|injection|dose)\b/,
      /\b(it is|it's|that is|that's) (safe|fine|okay|ok) (for you )?to (travel|fly|go)( with| despite| even)\b/,
      /\b(no need|don't need|do not need) (to )?(see|consult|visit) (a |your )?(doctor|physician|hospital)\b/,
      /\b(vaccin(e|ation)s?|immuni[sz]ation)s? (is|are) (not )?(required|needed|necessary|mandatory)\b/,
      /\b(don't|do not) worry about (the )?(heat|crowds?|your (health|condition|heart|blood pressure|diabetes))\b/,
    ],
  },
  {
    id: "CLOSE_COMPLAINT",
    label: "close or dismiss a complaint",
    patterns: [
      /\b(your |the )?(complaint|issue|concern|case|ticket) (is|has been|was|have been) (now )?(resolved|closed|settled|sorted|dismissed|rejected)\b/,
      /\bwe (consider|regard|treat) (this|that|the|your)( matter| complaint| issue| case)? (as )?(closed|resolved|settled)\b/,
      /\b(nothing|no further action) (more |else )?(can|will|to) be done\b/,
    ],
  },
  {
    id: "MARKETING_BROADCAST",
    label: "send a marketing broadcast",
    patterns: [
      /\b(we|i)( will|'ll| are| am)? (be )?(sending|send|broadcast(ing)?) (this|the|our|a) (offer|promotion|promo|message|newsletter|deal) to (all|every|our) (customers|clients|contacts|subscribers|pilgrims|leads)\b/,
      /\b(broadcast|bulk message|mass message|mass mailing)\b/,
    ],
  },
];

/** The text a phrase rule reads: lower-cased, accents removed, curly quotes straightened, spaces collapsed. */
export function normaliseForMatching(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Digit runs of 6–20 digits, allowing single spaces or hyphens between groups ("1234 5678 90"). */
function accountLikeNumbers(text: string): string[] {
  const runs = text.match(/\d(?:[\s-]?\d){5,19}/g) ?? [];
  return runs.map((run) => run.replace(/\D/g, "")).filter((digits) => digits.length >= 6 && digits.length <= 20);
}

const BANK_CONTEXT = /\b(bank|account|a\/c|acc|acct|iban|swift|sort code|routing|transfer to|deposit to|pay to)\b/;

export interface NeverPromiseMatch {
  id: NeverAutonomousId;
  label: string;
  /** The words that triggered it, so the person who reads "withheld" can see why. */
  span: string;
}

/**
 * Every deny-list entry the text says. Independent of any autonomy level: the level is not an input, so no level can change
 * the answer. `approvedAccountDigits` is the agency's locked list; bank details are only ever allowed if they are on it.
 */
export function findNeverPromise(text: string, approvedAccountDigits: readonly string[] = []): NeverPromiseMatch[] {
  const normalised = normaliseForMatching(text);
  const found: NeverPromiseMatch[] = [];
  for (const entry of NEVER_AUTONOMOUS) {
    for (const pattern of entry.patterns) {
      const match = pattern.exec(normalised);
      if (match) {
        found.push({ id: entry.id, label: entry.label, span: match[0].slice(0, 120) });
        break;
      }
    }
  }

  if (BANK_CONTEXT.test(normalised)) {
    const approved = new Set(approvedAccountDigits.map((account) => account.replace(/\D/g, "")).filter(Boolean));
    const unapproved = accountLikeNumbers(normalised).find((digits) => !approved.has(digits));
    if (unapproved) found.push({ id: "SEND_UNAPPROVED_BANK_DETAILS", label: "give bank details that are not on the approved list", span: unapproved });
  }
  return found;
}

/** The single answer every caller uses. `level` is accepted so a caller can pass what it has, and is deliberately ignored. */
export function refuseNeverPromise(text: string, options: { level?: AutonomyLevel; approvedAccountDigits?: readonly string[] } = {}): { refused: boolean; matches: NeverPromiseMatch[] } {
  void options.level;
  const matches = findNeverPromise(text, options.approvedAccountDigits ?? []);
  return { refused: matches.length > 0, matches };
}
