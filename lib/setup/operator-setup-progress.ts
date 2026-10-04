import { deriveSetupProgress, type SetupStateRow } from "./setup-steps";

/**
 * Everything the operator console needs to tell how far each agency got in the
 * guided setup, fetched once for all agencies (see operator-setup-loader.ts) and
 * indexed by agency id. Applying the owner's own `deriveSetupProgress` to it
 * guarantees the operator and the owner always see the same count.
 */
export interface OperatorSetupSources {
  activeStaffByAgency: Map<string, number>;
  whatsappConnected: Set<string>;
  pageChannelConnected: Set<string>;
  smtpSaved: Set<string>;
  agenciesWithPaymentAccount: Set<string>;
  agenciesWithPackage: Set<string>;
  stateByAgency: Map<string, SetupStateRow>;
}

const NO_STATE: SetupStateRow = { steps: {}, basicsConfirmedAt: null, passwordSetAt: null, guideDismissedAt: null, lastStep: null };

export function summariseAgencySetup(agencyId: string, sources: OperatorSetupSources): { doneCount: number; total: number } {
  const progress = deriveSetupProgress(
    {
      activeStaffCount: sources.activeStaffByAgency.get(agencyId) ?? 0,
      channelConnected:
        sources.whatsappConnected.has(agencyId) || sources.pageChannelConnected.has(agencyId) || sources.smtpSaved.has(agencyId),
      paymentAccountCount: sources.agenciesWithPaymentAccount.has(agencyId) ? 1 : 0,
      packageCount: sources.agenciesWithPackage.has(agencyId) ? 1 : 0,
    },
    sources.stateByAgency.get(agencyId) ?? NO_STATE,
  );
  return { doneCount: progress.doneCount, total: progress.total };
}
