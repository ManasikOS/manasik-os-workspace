import "server-only";

import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SIGNUP_LIMIT_WINDOW_MINUTES,
  evaluateSignupRateLimit,
  hashSignupIdentifier,
  type SignupRateLimitDecision,
} from "./signup-rate-limit";

/** Best-effort caller address. Behind Vercel/proxies the first `x-forwarded-for` hop is the client. */
async function readClientAddress(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headerList.get("x-real-ip") || "unknown";
}

/**
 * Counts this email's and this address's recent signup attempts, refuses if
 * either is over its limit, and otherwise records the attempt.
 *
 * Every request counts, successful or not — the limit exists because each one
 * can send an email. Fails closed: if the ledger cannot be read, the request
 * is refused rather than left unmetered.
 */
export async function checkAndRecordSignupAttempt(admin: SupabaseClient, email: string): Promise<SignupRateLimitDecision> {
  const emailHash = hashSignupIdentifier(email);
  const ipHash = hashSignupIdentifier(await readClientAddress());
  const since = new Date(Date.now() - SIGNUP_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

  const [emailCount, ipCount] = await Promise.all([
    admin.from("signup_attempts").select("id", { count: "exact", head: true }).eq("email_hash", emailHash).gte("created_at", since),
    admin.from("signup_attempts").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since),
  ]);

  if (emailCount.error || ipCount.error) {
    console.error("[onboarding] signup_attempts read failed", { message: emailCount.error?.message ?? ipCount.error?.message });
    return { allowed: false, message: "Something went wrong. Please try again in a few minutes." };
  }

  const decision = evaluateSignupRateLimit({ emailAttempts: emailCount.count ?? 0, ipAttempts: ipCount.count ?? 0 });
  if (!decision.allowed) return decision;

  const { error } = await admin.from("signup_attempts").insert({ email_hash: emailHash, ip_hash: ipHash });
  if (error) {
    console.error("[onboarding] signup_attempts insert failed", { message: error.message });
    return { allowed: false, message: "Something went wrong. Please try again in a few minutes." };
  }

  return { allowed: true };
}
