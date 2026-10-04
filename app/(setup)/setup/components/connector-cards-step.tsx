import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { resolveConnectorAvailability, type ConnectorId } from "@/lib/setup/connector-availability";
import { resolveConnectorCardState } from "@/lib/setup/connector-card-state";
import { SETUP_CONNECTOR_COPY } from "@/lib/setup/connector-copy";
import { loadConnectorStatuses, type ConnectorStatusSnapshot } from "@/lib/setup/connector-statuses";

import { ConnectorSetupCard } from "./connector-setup-card";
import { SetupSmtpForm } from "./setup-smtp-form";

/** Provider messages come from upstream APIs: cap them before display. */
const REASON_MAX_LENGTH = 200;

function renderConnectorCard(connector: ConnectorId, snapshot: ConnectorStatusSnapshot, available: boolean) {
  const state = resolveConnectorCardState({ rawStatus: snapshot.rawStatus, available });
  return (
    <ConnectorSetupCard
      key={connector}
      copy={SETUP_CONNECTOR_COPY[connector]}
      state={state}
      accountLabel={snapshot.accountLabel}
      reason={snapshot.lastError?.slice(0, REASON_MAX_LENGTH) ?? null}
      connectHref={available ? `/api/setup/connect/${connector}` : null}
    />
  );
}

/** The channels step: one independent card per connector, with ads tucked under "Advanced". */
export async function ConnectorCardsStep() {
  const availability = resolveConnectorAvailability(process.env);
  const statuses = await loadConnectorStatuses();

  const emailState = resolveConnectorCardState({ rawStatus: statuses.email.rawStatus, available: availability.email });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {renderConnectorCard("whatsapp", statuses.whatsapp, availability.whatsapp)}
        {renderConnectorCard("instagram", statuses.instagram, availability.instagram)}
        {renderConnectorCard("messenger", statuses.messenger, availability.messenger)}
        <ConnectorSetupCard
          copy={SETUP_CONNECTOR_COPY.email}
          state={emailState}
          accountLabel={statuses.email.accountLabel}
          reason={null}
          connectHref={null}
        >
          <SetupSmtpForm alreadySaved={statuses.email.rawStatus === "CONNECTED"} />
        </ConnectorSetupCard>
      </div>

      <Accordion>
        <AccordionItem value="advanced">
          <AccordionTrigger>Advanced: connect your ad accounts</AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-1 gap-4 pt-2 lg:grid-cols-2">
              {renderConnectorCard("meta_ads", statuses.metaAds, availability.metaAds)}
              {renderConnectorCard("google_ads", statuses.googleAds, availability.googleAds)}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
