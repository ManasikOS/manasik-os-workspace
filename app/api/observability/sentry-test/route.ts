/**
 * Sends ONE deliberate test error to Sentry so an owner can prove error tracking works in an environment (TASK-031 A2). Open it in a
 * browser while signed in as an ADMIN; the answer says which Sentry environment the event was tagged with, and the event then appears
 * in Sentry Issues as "Sentry test event".
 *
 * Not public: proxy.ts keeps it behind the normal sign-in (it is deliberately NOT in MACHINE_ROUTES), and the handler then requires a
 * verified user with the ADMIN role, so nobody can use it to flood the project with events. Carries no customer data.
 */

import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { getUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401, headers: NO_STORE });

  const { role } = await getCurrentStaffRole();
  if (role !== "ADMIN") return NextResponse.json({ error: "Only an ADMIN can send the Sentry test event" }, { status: 403, headers: NO_STORE });

  const client = Sentry.getClient();
  const dsnConfigured = Boolean(client?.getOptions().dsn);
  const environment = client?.getOptions().environment ?? null;

  const eventId = Sentry.captureException(new Error("Sentry test event"), { tags: { sentry_test: "true" }, fingerprint: ["sentry-test"] });
  // A serverless function can freeze right after answering, so wait for the event to leave first.
  const flushed = await Sentry.flush(3000);

  return NextResponse.json({ sent: dsnConfigured && flushed, dsnConfigured, flushed, environment, eventId }, { headers: NO_STORE });
}
