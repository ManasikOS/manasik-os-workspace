export type DomainAuthenticationState = "PASS" | "MISSING" | "MULTIPLE_SPF" | "MALFORMED" | "LOOKUP_FAILED" | "SELECTOR_MISMATCH";
export function assessSpf(records: string[]): DomainAuthenticationState {
  const spf = records.filter((record) => record.trim().toLowerCase().startsWith("v=spf1"));
  if (spf.length === 0) return "MISSING";
  if (spf.length > 1) return "MULTIPLE_SPF";
  return spf[0].trim().toLowerCase().endsWith("all") ? "PASS" : "MALFORMED";
}
export function assessDmarc(records: string[]): DomainAuthenticationState {
  if (records.length === 0) return "MISSING";
  return records.some((record) => /^v=DMARC1;.*\bp=(none|quarantine|reject)\b/i.test(record)) ? "PASS" : "MALFORMED";
}
export function assessDkim(records: string[], selector: string): DomainAuthenticationState {
  if (!selector.trim()) return "SELECTOR_MISMATCH";
  if (records.length === 0) return "MISSING";
  return records.some((record) => /v=DKIM1/i.test(record) && /p=/.test(record)) ? "PASS" : "MALFORMED";
}
