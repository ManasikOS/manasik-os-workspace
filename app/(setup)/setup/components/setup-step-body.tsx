import { getSessionUser } from "@/lib/dal";
import type { SetupProgress } from "@/lib/setup/setup-steps";
import { loadBasicsStepData, loadSeatCapacity, loadSetupPaymentAccounts } from "@/lib/setup/setup-essentials-data";

import { AccountPasswordStep } from "./account-password-step";
import { AgencyBasicsStep } from "./agency-basics-step";
import { ConnectorCardsStep } from "./connector-cards-step";
import { PaymentsStep } from "./payments-step";
import { TeamInviteStep } from "./team-invite-step";

/**
 * The step-specific content shown inside the frame. The first-package step has
 * none on purpose: it links to the existing Packages flow (plan §13 Q6).
 * Data is loaded only for the step being viewed.
 */
export async function SetupStepBody({ stepId, progress }: { stepId: string; progress: SetupProgress }) {
  const stepStatus = progress.steps.find((step) => step.id === stepId)?.status;

  switch (stepId) {
    case "account": {
      const user = await getSessionUser();
      return <AccountPasswordStep email={user?.email ?? ""} alreadySet={stepStatus === "DONE"} />;
    }
    case "agency": {
      const { settings, localeRows } = await loadBasicsStepData();
      return (
        <AgencyBasicsStep
          initial={{
            agencyName: settings.agency_name,
            country: settings.default_country,
            currency: settings.default_currency,
            timezone: settings.timezone,
            language: settings.default_language,
          }}
          confirmed={stepStatus === "DONE"}
          localeRows={localeRows}
          hasLogo={Boolean(settings.logo_path?.trim())}
        />
      );
    }
    case "team":
      return <TeamInviteStep capacity={await loadSeatCapacity()} />;
    case "channels":
      return <ConnectorCardsStep />;
    case "payments":
      return <PaymentsStep accounts={await loadSetupPaymentAccounts()} />;
    default:
      return null;
  }
}
