import { redirectToAuthorisedLegacyFinanceTab } from "../legacy-finance-redirect";

/** Retired finance workspace entrypoint; retained for existing bookmarks and action links. */
export const dynamic = "force-dynamic";

export default async function FinancePaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  await redirectToAuthorisedLegacyFinanceTab(await searchParams);
}
