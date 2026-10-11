"use client";

import { useEffect, useState } from "react";

import { normaliseMobile } from "@/lib/data/leads";
import type { DuplicateLeadSummary } from "@/lib/data/leads-repository";

import { checkLeadDuplicateAction } from "../../actions";

export type LeadDuplicateCheckStatus =
  "idle" | "checking" | "clear" | "found" | "failed";

export interface LeadDuplicateMatch {
  lead: DuplicateLeadSummary;
  matchedOn: "mobile" | "email";
}

const LOOKUP_DELAY_MS = 400;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SettledLookup {
  key: string;
  status: "clear" | "found" | "failed";
  match: LeadDuplicateMatch | null;
}

/**
 * Asks the server whether this mobile or email already belongs to a lead.
 *
 * Starts once the mobile has nine digits or the email looks complete, waits a
 * moment after the last keystroke, and ignores an answer to a question that
 * has since changed. A failed lookup is reported as `failed`, not as "no
 * duplicate": `createLeadAction` checks again when the lead is created.
 */
export function useLeadDuplicateCheck({
  mobile,
  email,
}: {
  mobile: string;
  email: string;
}): { status: LeadDuplicateCheckStatus; duplicate: LeadDuplicateMatch | null } {
  const normalisedMobile = normaliseMobile(mobile);
  const cleanEmail = email.trim().toLowerCase();
  const lookupMobile = normalisedMobile.length >= 9 ? normalisedMobile : "";
  const lookupEmail = EMAIL_SHAPE.test(cleanEmail) ? cleanEmail : "";
  const key =
    lookupMobile || lookupEmail ? `${lookupMobile}|${lookupEmail}` : null;

  // The last answer, tagged with the question it answers. State is only set
  // after the server replies, never synchronously inside the effect.
  const [settled, setSettled] = useState<SettledLookup | null>(null);

  useEffect(() => {
    if (key === null) return;
    let ignored = false;

    const timer = setTimeout(async () => {
      let outcome: SettledLookup;
      try {
        const result = await checkLeadDuplicateAction({
          mobile: lookupMobile,
          email: lookupEmail,
        });
        outcome = result.ok
          ? {
              key,
              status: result.duplicate ? "found" : "clear",
              match: result.duplicate,
            }
          : { key, status: "failed", match: null };
      } catch {
        outcome = { key, status: "failed", match: null };
      }
      if (!ignored) setSettled(outcome);
    }, LOOKUP_DELAY_MS);

    return () => {
      ignored = true;
      clearTimeout(timer);
    };
  }, [key, lookupMobile, lookupEmail]);

  if (key === null) return { status: "idle", duplicate: null };
  if (settled === null || settled.key !== key) {
    return { status: "checking", duplicate: null };
  }
  return { status: settled.status, duplicate: settled.match };
}
