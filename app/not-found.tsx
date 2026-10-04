import Link from "next/link";

/**
 * Root 404 — catches an unknown URL before any session exists (e.g. a typo
 * on `/login` or a stale bookmark), so it renders without the app shell.
 * `app/(main)/not-found.tsx` is the one most `notFound()` calls actually hit
 * (a role without a module's `viewModule` capability), and keeps the sidebar.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link
        href="/dashboard"
        className="mt-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
