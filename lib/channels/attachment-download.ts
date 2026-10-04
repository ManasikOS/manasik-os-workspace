/**
 * Downloading a customer's attachment (a voice note) that Messenger or Instagram sent as a URL.
 *
 * Unlike WhatsApp, where the payload names a media id we look up through the Graph API, these channels put a
 * ready-made URL in the webhook. That URL is a fetch target chosen by whoever sent the payload, so it is treated
 * as untrusted even though the payload is signed: it must be https on a Meta content host, redirects are
 * followed only to another such host, and the body is read with a size cap so an oversized file cannot exhaust
 * memory. Plan §9.8: whether the URL needs the access token is unconfirmed — it is fetched without one first, and
 * retried with the Page token only when Meta answers 401/403 (and only ever to a Meta host).
 */

/** Hosts Meta serves attachments from. A leading dot means "this domain and any subdomain of it". */
const META_CONTENT_HOST_SUFFIXES = [".fbcdn.net", ".cdninstagram.com", ".facebook.com", ".fbsbx.com"] as const;

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;

export class AttachmentDownloadError extends Error {
  /** True when retrying cannot help (a disallowed host, a file over the size cap). */
  readonly permanent: boolean;

  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = "AttachmentDownloadError";
    this.permanent = permanent;
  }
}

/** https, no credentials or custom port in the URL, and a host that is a Meta content domain. */
export function isAllowedAttachmentUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return META_CONTENT_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** The audio MIME type to give the transcriber. Voice notes are AAC in an MP4 container, which Meta's CDN often labels generically. */
export function audioMimeForResponse(contentType: string | null): string {
  const base = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return base.startsWith("audio/") ? base : "audio/mp4";
}

async function readCapped(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw new AttachmentDownloadError("The attachment is too large.", true);

  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new AttachmentDownloadError("The attachment is too large.", true);
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AttachmentDownloadError("The attachment is too large.", true);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function downloadMetaFileInternal(
  url: string,
  token: string | null,
  options: { maxBytes: number; fetchImpl?: typeof fetch },
): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function get(target: string, authorised: boolean): Promise<Response> {
    let current = target;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isAllowedAttachmentUrl(current)) throw new AttachmentDownloadError("The attachment is not on a Meta content host.", true);
      const response = await fetchImpl(current, {
        redirect: "manual",
        headers: authorised && token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
      return response;
    }
    throw new AttachmentDownloadError("The attachment redirected too many times.", true);
  }

  let response = await get(url, false);
  if ((response.status === 401 || response.status === 403) && token) response = await get(url, true);
  if (!response.ok) {
    // An expired or removed attachment will not come back; a server error might.
    throw new AttachmentDownloadError(`The attachment download failed (${response.status}).`, response.status === 404 || response.status === 410);
  }

  const mimeType = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
  return { bytes: await readCapped(response, options.maxBytes), mimeType };
}

/** Safely downloads an arbitrary image/document from a Meta CDN URL. */
export async function downloadMetaFile(
  url: string,
  token: string | null,
  options: { maxBytes: number; fetchImpl?: typeof fetch },
): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  return downloadMetaFileInternal(url, token, options);
}

export async function downloadMetaAttachment(
  url: string,
  token: string | null,
  options: { maxBytes: number; fetchImpl?: typeof fetch },
): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const file = await downloadMetaFileInternal(url, token, options);
  return { ...file, mimeType: audioMimeForResponse(file.mimeType) };
}
