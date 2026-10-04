/**
 * Whether the always-on worker (Q3) is what drains the queues, so the webhook and the staff send should not also start a drain of
 * their own after they respond. Set `INBOX_WORKER_ACTIVE=1` on the web deployment once a worker is running.
 *
 * Off by default, and safe either way: with it on and the worker down, the scheduled drains (once a minute) still pick every job
 * up, only slower. With it off, the worker and the after-response drains simply share the queue (claims never overlap).
 * Removing the webhook's own drain is what lets a webhook function return and be billed for milliseconds, not sit for 25 s.
 */
export function isInboxWorkerActive(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.INBOX_WORKER_ACTIVE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
