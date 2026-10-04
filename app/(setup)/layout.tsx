import "../globals.css";
import type { Metadata } from "next";

import { ThemeSwitch } from "@/components/ui/theme-switch";
import { requireSetupAdmin } from "@/lib/setup/setup-guard";

export const metadata: Metadata = { title: "Set up your workspace" };

/** Setup reads live per-agency data and per-request auth, so it is never cached. */
export const dynamic = "force-dynamic";

/**
 * Full-screen chrome for the guided setup: no app sidebar, just a theme switch.
 * Gated to the agency's administrator (docs/onboarding/plan.md §7.2); every
 * action re-checks, this only keeps other roles from seeing the screen.
 */
export default async function SetupLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireSetupAdmin();

  return (
    <div className="relative min-h-screen bg-linear-to-br from-primary/10 via-primary/5 to-background">
      <div className="absolute right-5 top-4">
        <ThemeSwitch />
      </div>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">{children}</div>
    </div>
  );
}
