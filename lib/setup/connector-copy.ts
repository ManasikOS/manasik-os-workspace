import type { ConnectorId } from "./connector-availability";

export type SetupConnectorKey = ConnectorId | "email";

export interface SetupConnectorCopy {
  title: string;
  /** What you get. */
  benefit: string;
  /** What you must have before starting. */
  needs: string;
  /** How long it takes. */
  time: string;
}

/** Plain-language card copy (docs/onboarding/plan.md §5.1 principle 4, §5.5): what it costs, what you need, what you get. */
export const SETUP_CONNECTOR_COPY: Record<SetupConnectorKey, SetupConnectorCopy> = {
  whatsapp: {
    title: "WhatsApp",
    benefit: "Receive and reply to pilgrim messages in one inbox.",
    needs: "A Facebook Business login.",
    time: "About 5 minutes",
  },
  instagram: {
    title: "Instagram",
    benefit: "Answer Instagram messages from the same inbox.",
    needs: "An Instagram business or creator account.",
    time: "About 3 minutes",
  },
  messenger: {
    title: "Facebook Messenger",
    benefit: "Answer messages sent to your Facebook Page.",
    needs: "Admin access to your Facebook Page.",
    time: "About 3 minutes",
  },
  email: {
    title: "Email (SMTP)",
    benefit: "Send emails to pilgrims from your own address.",
    needs: "Your email provider's SMTP details.",
    time: "About 5 minutes",
  },
  meta_ads: {
    title: "Meta Ads",
    benefit: "See what your Facebook and Instagram ads cost and which leads they bring.",
    needs: "Access to your Meta ad account.",
    time: "About 3 minutes",
  },
  google_ads: {
    title: "Google Ads",
    benefit: "See what your Google ads cost and which leads they bring.",
    needs: "Access to your Google Ads account.",
    time: "About 3 minutes",
  },
};
