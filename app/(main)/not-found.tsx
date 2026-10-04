import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Renders inside the signed-in app shell (sidebar + header stay visible) —
 * this is the one most `notFound()` calls in the app actually hit: a role
 * without `viewModule` for the module being opened (see the `notFound()`
 * calls in e.g. `app/(main)/documents/page.tsx`), not a genuine 404.
 */
export default function MainNotFound() {
  return (
    <div className="flex w-full items-center justify-center py-20">
      <Card className="flex flex-col items-center gap-3 p-10 max-w-md text-center">
        <h2 className="text-lg font-semibold text-foreground">Not found</h2>
        <p className="text-sm text-muted-foreground">
          Either this page doesn&apos;t exist, or your role doesn&apos;t have access to it. Contact your
          agency administrator if you believe this is a mistake.
        </p>
        <Button variant="secondary" className="mt-2" render={<Link href="/dashboard" />}>
          Back to dashboard
        </Button>
      </Card>
    </div>
  );
}
