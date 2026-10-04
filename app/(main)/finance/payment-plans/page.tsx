import { redirectToAuthorisedFinanceWorkspace } from "../legacy-finance-redirect";

export const dynamic = "force-dynamic";

export default async function PaymentPlansPage() {
  await redirectToAuthorisedFinanceWorkspace({ view: "receivables", subview: "payment-plans" });
}
