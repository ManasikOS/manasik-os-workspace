import { redirectToAuthorisedFinanceWorkspace } from "../legacy-finance-redirect";

export const dynamic = "force-dynamic";

export default async function DepartureProfitabilityPage() {
  await redirectToAuthorisedFinanceWorkspace({ view: "departure-pnl" });
}
