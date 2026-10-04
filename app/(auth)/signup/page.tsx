import Link from "next/link";
import { Card } from "@/components/ui/card";

import { SignupForm } from "./components/signup-form";

/**
 * Self-serve agency signup — gated by SIGNUP_MODE (Phase 5 of
 * docs/architecture/multi-tenancy-implementation-plan.md, D6). "invite_only" is the
 * default: this page still exists and links here still work, but shows a
 * closed message instead of a form, matching the current single-agency
 * posture (accounts are created by an administrator — see
 * app/(auth)/README.md §4) until a deployment explicitly opts in.
 */
export default function SignupPage() {
  const isOpen = process.env.SIGNUP_MODE === "open";

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-md gap-5 p-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold text-foreground">Create your agency workspace</h1>
          {!isOpen && (
            <p className="text-sm text-muted-foreground">
              Self-serve signup isn&apos;t open on this deployment yet. Contact us to have your
              workspace created, or{" "}
              <Link href="/login" className="underline underline-offset-2">
                sign in
              </Link>{" "}
              if you already have an account.
            </p>
          )}
        </div>
        {isOpen && <SignupForm />}
      </Card>
    </div>
  );
}
