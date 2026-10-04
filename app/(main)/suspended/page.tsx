import { ShieldOff } from "lucide-react";

import { signOutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

/**
 * Rendered by `app/(main)/layout.tsx` in place of the sidebar app when the
 * caller's agency is SUSPENDED or CANCELLED (F7 of
 * docs/architecture/multi-tenancy-implementation-plan.md). Staff can still authenticate —
 * `current_agency_id()` simply resolves to null once here, so every RLS
 * policy denies every row — this page is the readable explanation for that
 * otherwise-empty app.
 */
export default function SuspendedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldOff className="size-7" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold text-foreground">This workspace is suspended</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your account is signed in, but your agency&apos;s workspace is not currently active. Contact your
          administrator or our support team to restore access.
        </p>
      </div>
      <form action={signOutAction}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </div>
  );
}
