/**
 * Configuration check for the go-live gate (TASK-032 S2): which required settings are present, what environment this deployment says it is,
 * and a short fingerprint of each secret and identifier so two environments can be compared. Never a secret or identifier value; a non-secret
 * config setting (the environment name, the Graph version, a flag) is reported as its value. See lib/ops/required-env.ts.
 *
 * Authenticated by `Authorization: Bearer $CRON_SECRET` alone (proxy.ts lets /api/health through without a session). Unlike /api/health and
 * /api/health/ready this one is NOT public: it describes how the deployment is configured. An incomplete configuration still answers 200 with
 * `ready: false` and the list of problems, so a caller can tell "the check ran and found problems" from "the check could not run".
 */

import { NextResponse, type NextRequest } from "next/server";

import { evaluateEnvironment } from "@/lib/ops/required-env";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500, headers: NO_STORE });
  if (!hasValidBearerSecret(request.headers.get("authorization"), expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  return NextResponse.json(
    { build: (process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 7), ...evaluateEnvironment(process.env) },
    { headers: NO_STORE },
  );
}
