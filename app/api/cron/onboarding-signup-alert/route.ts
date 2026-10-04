import { NextResponse, type NextRequest } from "next/server";

import { detectSignupSpike } from "@/lib/onboarding/signup-spike";
import { loadSignupAttemptCounts } from "@/lib/setup/operator-setup-loader";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";

/**
 * Hourly check for a burst of signup requests (docs/onboarding/plan.md D7).
 * Each request can send an email, so a spike is either a bot run or someone
 * using signup to email-bomb an address. On a spike this logs a structured
 * `[onboarding][alert]` error line for the log drain / alerting to pick up, and
 * answers 500 so a monitor on the cron sees it too. The operator console shows
 * the same numbers.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (!hasValidBearerSecret(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = detectSignupSpike(await loadSignupAttemptCounts());
  if (result.spike) {
    console.error("[onboarding][alert] signup request spike", result);
  }
  return NextResponse.json(result, { status: result.spike ? 500 : 200 });
}
