import { notFound, redirect } from "next/navigation";

import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  financeWorkspaceHref,
  resolveFinanceWorkspaceNavigation,
  resolveLegacyFinanceTabNavigation,
  type FinanceWorkspaceQuery,
} from "@/lib/finance/workspace-navigation";

async function redirectToResolvedFinanceNavigation(
  resolveNavigation: (role: Awaited<ReturnType<typeof getCurrentStaffRole>>["role"]) => ReturnType<
    typeof resolveFinanceWorkspaceNavigation
  >,
): Promise<never> {
  const { role } = await getCurrentStaffRole();
  const navigation = resolveNavigation(role);
  if (!navigation) notFound();

  redirect(financeWorkspaceHref(navigation));
}

/** Redirects a retired Finance route to a destination authorised for this staff role. */
export async function redirectToAuthorisedFinanceWorkspace(query: FinanceWorkspaceQuery): Promise<never> {
  return redirectToResolvedFinanceNavigation((role) =>
    resolveFinanceWorkspaceNavigation(query, capabilitiesForFinance(role)),
  );
}

/** Redirects a retired `/finance/payments?tab=` link while retaining its old tab context. */
export async function redirectToAuthorisedLegacyFinanceTab(query: { tab?: string | string[] }): Promise<never> {
  return redirectToResolvedFinanceNavigation((role) =>
    resolveLegacyFinanceTabNavigation(query, capabilitiesForFinance(role)),
  );
}
