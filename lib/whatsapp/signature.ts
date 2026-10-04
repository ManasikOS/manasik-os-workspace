import "server-only";

import { verifyMetaSignature } from "@/lib/meta/signature";

/**
 * Verifies Meta's `X-Hub-Signature-256` header against the **raw** request body. The implementation is
 * shared by every Meta channel (lib/meta/signature.ts); this name is kept so the WhatsApp webhook and
 * its route are untouched.
 */
export function verifyWhatsAppSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  return verifyMetaSignature(rawBody, signatureHeader, appSecret);
}
