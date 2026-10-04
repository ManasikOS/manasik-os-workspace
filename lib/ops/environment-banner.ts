/**
 * The label for the environment banner (TASK-032 S9): staging, or any other named non-production environment, must never be mistaken for
 * production. Driven by the same `SENTRY_ENVIRONMENT` that names the environment everywhere else, so it needs no setting of its own:
 * production and an unset value (local development) show nothing, anything else shows its name.
 */
export function environmentBannerLabel(env: Record<string, string | undefined> = process.env): string | null {
  const name = env.SENTRY_ENVIRONMENT?.trim();
  if (!name || name.toLowerCase() === "production") return null;
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}
