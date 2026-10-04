/**
 * Finding the Instagram accounts a login can connect. Instagram messaging goes through a Facebook Page, so an
 * account is only reachable as "the Instagram account linked to a Page the login shared". This lists those
 * pairs; one bad Page never hides the others, and a Page with no linked account simply contributes nothing.
 */

import type { LinkedInstagramAccount } from "@/lib/channels/instagram/client";
import type { GrantedPage } from "@/lib/channels/messenger/client";

export interface InstagramCandidate {
  account: LinkedInstagramAccount;
  page: GrantedPage;
}

export async function discoverInstagramAccounts(
  pages: GrantedPage[],
  findLinked: (page: GrantedPage) => Promise<LinkedInstagramAccount | null>,
): Promise<{ candidates: InstagramCandidate[]; pagesWithoutInstagram: GrantedPage[] }> {
  const candidates: InstagramCandidate[] = [];
  const pagesWithoutInstagram: GrantedPage[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    let account: LinkedInstagramAccount | null = null;
    try {
      account = await findLinked(page);
    } catch {
      // Not fatal: a Page we cannot read is treated as having no linked account.
    }
    if (!account) {
      pagesWithoutInstagram.push(page);
    } else if (!seen.has(account.id)) {
      seen.add(account.id); // two Pages can never share one account, but a repeated grant must not double-list it
      candidates.push({ account, page });
    }
  }
  return { candidates, pagesWithoutInstagram };
}

/** The sentence shown when a login yields no Instagram account, saying what to fix. */
export function noInstagramAccountMessage(pagesShared: number, pagesWithoutInstagram: GrantedPage[]): string {
  if (pagesShared === 0) {
    return "Meta did not share any Facebook Page with this app. Instagram messaging goes through the Page: connect again, tick the Page linked to your Instagram account, and make sure you manage it.";
  }
  const names = pagesWithoutInstagram.map((page) => page.name ?? `Page ${page.id}`).join(", ");
  return `No Instagram professional account is linked to ${names}. Switch the account to Professional in Instagram, link it to the Page in Meta Business Suite (Settings → Accounts → Instagram accounts), then connect again.`;
}
