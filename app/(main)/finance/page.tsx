import { notFound } from "next/navigation";

import {
  financeWorkspaceHref,
  resolveFinanceWorkspaceNavigation,
} from "@/lib/finance/workspace-navigation";

import FinanceWorkspace from "./payments/components/finance-workspace";
import { FinanceProvider } from "./payments/finance-store";
import { loadFinanceSnapshot } from "./payments/load-finance-snapshot";

export const dynamic = "force-dynamic";

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; subview?: string | string[]; evidenceId?: string | string[] }>;
}) {
  const [loaded, query] = await Promise.all([loadFinanceSnapshot(), searchParams]);
  if (!loaded) notFound();

  const navigation = resolveFinanceWorkspaceNavigation(query, loaded.can);

  return (
    <FinanceProvider
      snapshot={loaded.snapshot}
      owingBookings={loaded.owingBookings}
      refundableBookings={loaded.refundableBookings}
      currentStaffName={loaded.currentStaffName}
      role={loaded.role}
      can={loaded.can}
    >
      <FinanceWorkspace
        key={navigation ? financeWorkspaceHref(navigation) : "finance-unavailable"}
        initialNavigation={navigation}
      />
    </FinanceProvider>
  );
}
