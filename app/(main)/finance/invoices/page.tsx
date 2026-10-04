import { redirectToAuthorisedFinanceWorkspace } from "../legacy-finance-redirect";

/** Retired Finance route; retained for existing bookmarks and action links. */
export const dynamic = "force-dynamic";

export default async function FinanceInvoicesPage() {
  await redirectToAuthorisedFinanceWorkspace({ view: "receivables", subview: "invoices" });
}
