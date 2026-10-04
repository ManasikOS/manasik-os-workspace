import { resolveTxt } from "node:dns/promises";
import { assessDkim, assessDmarc, assessSpf, type DomainAuthenticationState } from "./domain-authentication";

const DNS_TIMEOUT_MS = 4_000;
export interface DomainAuthenticationCheck { spf: DomainAuthenticationState; dkim: DomainAuthenticationState; dmarc: DomainAuthenticationState; checkedAt: string; }
export type TxtResolver = (name: string) => Promise<string[][]>;
function normalizeTxt(records: string[][]): string[] { return records.map((parts) => parts.join("")); }
async function boundedTxtLookup(name: string, lookup: TxtResolver): Promise<string[] | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), DNS_TIMEOUT_MS));
  try { return await Promise.race([lookup(name).then(normalizeTxt), timeout]); } catch { return null; }
}
export async function inspectDomainAuthentication(input: { domain: string; dkimSelector: string }, lookup: TxtResolver = resolveTxt): Promise<DomainAuthenticationCheck> {
  const domain = input.domain.trim().toLowerCase();
  const [spfRecords, dkimRecords, dmarcRecords] = await Promise.all([
    boundedTxtLookup(domain, lookup), boundedTxtLookup(`${input.dkimSelector.trim()}._domainkey.${domain}`, lookup), boundedTxtLookup(`_dmarc.${domain}`, lookup),
  ]);
  return { spf: spfRecords === null ? "LOOKUP_FAILED" : assessSpf(spfRecords), dkim: dkimRecords === null ? "LOOKUP_FAILED" : assessDkim(dkimRecords, input.dkimSelector), dmarc: dmarcRecords === null ? "LOOKUP_FAILED" : assessDmarc(dmarcRecords), checkedAt: new Date().toISOString() };
}
