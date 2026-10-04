/**
 * SENSITIVE_DOC_RECEIVED — the customer sent a file that looks like an identity or financial document. Pure, no model.
 *
 * There is no image classifier yet (MI5.4), so this reads only what is on the message: the file name and the caption. It
 * fires for an image or document whose name or caption names a passport, ID card, birth certificate, bank statement or
 * similar. A plain photo, or a text message that merely mentions a passport, never fires.
 */

import { normaliseText, snippetOf, type RiskDetector, type RiskFacts, type RiskFinding } from "../types";

const SENSITIVE_NAME = /\b(passport|national id|nic|identity card|id card|birth cert(ificate)?|bank statement|statement of account|driving licen[cs]e|visa copy|emirates id|iqama)\b|passport|birth[-_ ]?cert/;

export function detectSensitiveDocReceived(facts: RiskFacts): RiskFinding | null {
  const message = facts.latest;
  if (!message || (message.type !== "IMAGE" && message.type !== "DOCUMENT")) return null;
  const label = normaliseText(`${message.attachmentName ?? ""} ${message.text}`.replace(/[_.-]+/g, " "));
  if (!SENSITIVE_NAME.test(label)) return null;
  return { code: "SENSITIVE_DOC_RECEIVED", messageId: message.id, confidence: 0.8, evidence: [{ messageId: message.id, snippet: snippetOf(message.attachmentName ?? message.text) }] };
}

export const sensitiveDocReceived: RiskDetector = { code: "SENSITIVE_DOC_RECEIVED", detect: detectSensitiveDocReceived };
