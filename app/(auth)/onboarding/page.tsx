import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/dal";
import { provisionAgencyForSignup } from "@/lib/onboarding/provision-signup";
import { createAdminClient } from "@/utils/supabase/admin";

/**
 * Where a self-serve signup's confirmation link lands (Phase 5 of
 * docs/architecture/multi-tenancy-implementation-plan.md, D6; Slice 1 of
 * docs/onboarding/plan.md). The link confirms the session — `requireUser()`
 * below is the proof this email is real — and only then does provisioning
 * happen: never before confirmation.
 *
 * Provisioning is one atomic call (`provision_agency_from_signup`), so a
 * refresh, a second tab or a retry after a dropped response lands on the same
 * agency instead of creating another. Anything that goes wrong renders a
 * screen with a way forward rather than throwing a 500.
 *
 * The service-role client is required here on purpose:
 * `pending_agency_signups` and the RPC both have no grant for `authenticated`
 * — this route is the one place that is allowed to act on the caller's behalf
 * before they have any agency membership to be scoped by.
 */
export default async function OnboardingPage() {
  const user = await requireUser();
  const admin = createAdminClient();

  if (!user.email) {
    return (
      <OnboardingMessagePanel
        title="We couldn't confirm your email"
        body="Your account has no email address, so we can't set up a workspace for it. Sign in with a different account, or contact us for help."
        actionHref="/login"
        actionLabel="Back to sign in"
      />
    );
  }

  const outcome = await provisionAgencyForSignup(admin, { userId: user.id, email: user.email });

  if (outcome.kind === "provisioned") {
    redirect("/setup");
  }

  if (outcome.kind === "no_signup") {
    // Either a staff member who was invited to an existing agency (they have a
    // profile and belong on the dashboard), or a signed-in user with no
    // workspace and no signup on file. The second must not be sent to
    // /dashboard: the dashboard layout sends users with no agency back here.
    const { data: profile } = await admin.from("staff_profiles").select("id").eq("id", user.id).maybeSingle();
    if (profile) redirect("/dashboard");

    return (
      <OnboardingMessagePanel
        title="No workspace set up yet"
        body="We couldn't find a workspace signup for this email. You can create one now, or sign in with the account your agency invited."
        actionHref="/signup"
        actionLabel="Create your workspace"
      />
    );
  }

  if (outcome.kind === "expired") {
    return (
      <OnboardingMessagePanel
        title="That signup link has expired"
        body="Signup links are valid for 7 days. Start again and we'll send you a new one."
        actionHref="/signup"
        actionLabel="Start again"
      />
    );
  }

  return (
    <OnboardingMessagePanel
      title="We couldn't finish setting up your workspace"
      body="Nothing was lost and no duplicate was created. Try again in a moment. If it keeps happening, contact us."
      actionHref="/onboarding"
      actionLabel="Try again"
    />
  );
}

function OnboardingMessagePanel({
  title,
  body,
  actionHref,
  actionLabel,
}: {
  title: string;
  body: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-md gap-4 p-6">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        <Button render={<Link href={actionHref} />}>{actionLabel}</Button>
      </Card>
    </div>
  );
}
