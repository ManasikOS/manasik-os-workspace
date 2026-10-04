import type { Metadata } from "next";

import { colomboDayKey } from "@/lib/date";

export const metadata: Metadata = { title: "Terms of Service" };

// Must stay a monitored inbox: Meta's review checks that the Terms name a way to reach us.
const CONTACT_EMAIL = "support@manasikos.com";

export default function TermsOfServicePage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p>Last updated: {colomboDayKey()}</p>

      <p>
        These Terms govern use of Hajj &amp; Umrah CRM (&quot;the Platform&quot;) by a travel agency and its
        staff (&quot;the Agency&quot;, &quot;you&quot;).
      </p>

      <h2>The service</h2>
      <p>
        The Platform is an operations tool for travel agencies running Hajj and Umrah services: managing
        leads, departure groups, bookings, documents, visas, finance, reporting, and — where connected —
        WhatsApp communication with the Agency&apos;s own customers, optionally assisted by an AI agent.
      </p>

      <h2>Your WhatsApp connection</h2>
      <p>
        If you connect a WhatsApp Business number to the Platform, you are responsible for that number being
        yours to connect, for complying with WhatsApp&apos;s own Business Messaging Policy, and for any
        charges Meta bills you directly for WhatsApp usage — the Platform does not bill, front, or reconcile
        that cost on your behalf.
      </p>

      <h2>Acceptable use</h2>
      <p>
        You agree to use the Platform, and any connected WhatsApp number, only to communicate with customers
        who have a genuine relationship with your agency, and not to send unsolicited bulk messages, spam,
        or content that violates WhatsApp&apos;s policies or applicable law.
      </p>

      <h2>Your data</h2>
      <p>
        You retain ownership of the business records, customer data, and messages you or your customers send
        through the Platform. We process that data to operate the Platform for you, as described in our{" "}
        <a href="/legal/privacy">Privacy Policy</a>.
      </p>

      <h2>AI assistant</h2>
      <p>
        Where enabled, the Platform&apos;s AI assistant drafts and sends replies to your customers based on
        your own business data. You remain responsible for reviewing its configuration and for any reply it
        sends on your behalf; you may disable it at any time.
      </p>

      <h2>Availability and changes</h2>
      <p>
        We aim to keep the Platform available and reliable but do not guarantee uninterrupted service. We
        may update these Terms or the Platform&apos;s features from time to time; continued use after a
        change means you accept the update.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using the Platform, and disconnect any connected WhatsApp number, at any time. We may
        suspend or terminate access for a violation of these Terms or of WhatsApp&apos;s own policies.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these Terms can be sent to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </>
  );
}
