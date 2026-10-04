/** Meta documents a 3 MB ceiling on webhook payloads; 2 MiB is far above any real delivery and far below a flood. */
export const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Reads a webhook's raw body only if it fits the cap, or returns `null` so the route can answer 413 before any
 * parsing or database write. The declared `Content-Length` is checked first (cheap reject); the real length is
 * checked again after reading because that header is the sender's claim, not a guarantee.
 */
export async function readBoundedWebhookBody(request: Request, maxBytes: number = MAX_WEBHOOK_BODY_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const body = await request.text();
  return Buffer.byteLength(body, "utf8") > maxBytes ? null : body;
}
