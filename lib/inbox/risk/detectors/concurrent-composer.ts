/**
 * CONCURRENT_COMPOSER — somebody is writing a reply to this customer right now. Pure. Fires while `composing_by` is set and
 * was touched within the last two minutes; an old, forgotten marker never fires.
 */

import { type RiskDetector, type RiskFacts, type RiskFinding } from "../types";
import { COMPOSER_PRESENCE_TTL_MS, activeComposerPresence } from "@/lib/inbox/composer-presence";

export const COMPOSER_FRESH_MINUTES = COMPOSER_PRESENCE_TTL_MS / 60_000;

export function detectConcurrentComposer(facts: RiskFacts): RiskFinding | null {
  if (!facts.composing) return null;
  if (!activeComposerPresence(facts.composing, new Date(facts.now))) return null;
  return { code: "CONCURRENT_COMPOSER", messageId: null, confidence: 1, evidence: [{ messageId: null, snippet: "A colleague is writing a reply to this customer" }] };
}

export const concurrentComposer: RiskDetector = { code: "CONCURRENT_COMPOSER", detect: detectConcurrentComposer };
