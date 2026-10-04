/**
 * Shared Meta Graph HTTP client — the retry/backoff/error-body handling every Meta channel needs.
 * Extracted from lib/whatsapp/client.ts so Messenger (graph.facebook.com) and Instagram
 * (graph.instagram.com) reuse it instead of copying it. See
 * docs/modules/messenger-instagram-ai-agent-implementation-plan.md §3 / Phase 0.
 *
 * Pure HTTP: it takes the token as an argument and never reaches into Vault or the database.
 */

import "server-only";

export const META_GRAPH_HOSTS = {
  facebook: "https://graph.facebook.com",
  instagram: "https://graph.instagram.com",
} as const;

export type MetaGraphHost = keyof typeof META_GRAPH_HOSTS;

/**
 * The Graph version every new Meta channel calls. Meta's Messenger and Instagram docs show v25.0; the
 * fallback stays on the version WhatsApp already runs on so an environment that has not set
 * META_GRAPH_VERSION keeps working — set it explicitly (plan §12).
 */
export function metaGraphVersion(): string {
  return process.env.META_GRAPH_VERSION || "v21.0";
}

/** Thrown for any non-2xx Graph response; `body` is Meta's parsed error payload (or null). */
export class MetaGraphError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "MetaGraphError";
  }
}

export interface MetaGraphTarget {
  host: MetaGraphHost;
  /** e.g. "v25.0". */
  version: string;
}

export function graphBaseUrl(target: MetaGraphTarget): string {
  return `${META_GRAPH_HOSTS[target.host]}/${target.version}`;
}

/** Meta's own explanation lives in `body.error`; `error_user_msg` is the human-readable one when present. */
export function describeMetaError(body: unknown): string | undefined {
  const metaError = (body as { error?: { message?: string; error_user_msg?: string } } | null)?.error;
  return metaError?.error_user_msg || metaError?.message;
}

export interface MetaGraphFetchOptions extends RequestInit {
  /** Extra attempts on 429/5xx, with exponential backoff. Default 2. */
  retries?: number;
  /** Lets a caller keep its own error class (e.g. WhatsAppSendError) so existing `instanceof` checks still hold. */
  errorClass?: new (message: string, status: number, body: unknown) => MetaGraphError;
  /** Label used in the fallback error message. Default "Graph API". */
  label?: string;
}

export async function metaGraphFetch(
  target: MetaGraphTarget,
  path: string,
  token: string,
  init: MetaGraphFetchOptions = {},
): Promise<unknown> {
  const { retries = 2, errorClass = MetaGraphError, label = "Graph API", ...requestInit } = init;
  const url = `${graphBaseUrl(target)}${path}`;

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      ...requestInit,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...requestInit.headers,
      },
    });

    if (response.ok) return response.json();

    const body = await response.json().catch(() => null);
    const retryable = response.status === 429 || response.status >= 500;

    if (retryable && attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    }

    const detail = describeMetaError(body);
    throw new errorClass(
      detail ? `${label} ${response.status} on ${path}: ${detail}` : `${label} ${response.status} on ${path}`,
      response.status,
      body,
    );
  }
}
