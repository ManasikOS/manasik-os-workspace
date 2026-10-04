import type { Metadata } from "next";

import { colomboDayKey } from "@/lib/date";

export const metadata: Metadata = { title: "Privacy Policy" };

// Must stay a monitored inbox: the policy has to name a way to actually reach us, and Meta's review checks it.
const CONTACT_EMAIL = "support@manasikos.com";

export default function PrivacyPolicyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>Last updated: {colomboDayKey()}</p>

      <p>
        This Privacy Policy explains how Hajj &amp; Umrah CRM (&quot;the Platform&quot;, &quot;we&quot;) collects,
        uses, and protects information when a travel agency (&quot;the Agency&quot;) uses the Platform to manage
        its business, including communicating with its own customers over WhatsApp, Facebook Messenger and Instagram.
      </p>

      <h2>Who this applies to</h2>
      <p>
        The Platform is used by travel agency staff to manage leads, bookings, documents, and customer
        communication. Each Agency&apos;s data is isolated from every other Agency using the Platform.
      </p>

      <h2>WhatsApp messaging data</h2>
      <p>
        When an Agency connects its WhatsApp Business number to the Platform (via Meta&apos;s WhatsApp Cloud
        API, including Embedded Signup), we process the following on the Agency&apos;s behalf:
      </p>
      <ul>
        <li>The content of messages sent and received between the Agency and its own customers over WhatsApp</li>
        <li>The customer&apos;s WhatsApp phone number and profile name, as provided by WhatsApp</li>
        <li>Message delivery status (sent, delivered, read, failed) and timestamps</li>
        <li>
          Metadata needed to operate the connection: the Agency&apos;s WhatsApp Business Account ID, phone
          number ID, and an access token used only to send and receive messages on the Agency&apos;s behalf
        </li>
        <li>
          Where the Agency enables its AI assistant, the content of the conversation is sent to our AI
          provider (Anthropic) to generate a reply, and details of that exchange (token usage, cost, and a
          summary of any tool actions taken) are recorded for the Agency&apos;s own reporting
        </li>
      </ul>
      <p>
        This data is stored to give the Agency a working inbox, conversation history, and reporting — it is
        never sold, and it is never shared with another Agency using the Platform. Access tokens are stored
        encrypted (Supabase Vault) and are never exposed to Agency staff or displayed in full.
      </p>

      <h2>Messenger and Instagram messaging data</h2>
      <p>
        When an Agency connects its Facebook Page (Messenger) or its Instagram professional account to the Platform through
        Meta&apos;s Messenger Platform and Instagram messaging, we process the following on the Agency&apos;s behalf:
      </p>
      <ul>
        <li>The content of messages, and the attachments and voice notes, sent and received between the Agency and its own customers</li>
        <li>
          The customer&apos;s Messenger or Instagram identifier (a page-scoped or Instagram-scoped ID that is not a phone number) and,
          where Meta allows it, their profile name or Instagram username. We do not receive the customer&apos;s phone number from these
          channels; a number is stored only if the customer types one to the Agency
        </li>
        <li>Message delivery and read status and timestamps</li>
        <li>
          Metadata needed to operate the connection: the Facebook Page or Instagram account ID and name, the Meta user who connected it,
          and a Page access token used only to send and receive messages on the Agency&apos;s behalf
        </li>
        <li>
          Where the Agency enables its AI assistant on the channel, the conversation is sent to our AI providers to generate a reply. The
          assistant tells the customer it is an automated assistant, and a member of the Agency&apos;s staff can take over at any time
        </li>
        <li>
          Where the Agency enables voice notes, an audio message is sent to our speech-to-text provider to be turned into text, and the
          audio is discarded — it is not stored
        </li>
      </ul>
      <p>
        The same rules apply as for WhatsApp: the data is used only to give the Agency its inbox, history and reporting; it is never sold
        and never shared with another Agency; access tokens are stored encrypted and are never shown to staff. Replies can only be sent
        within the time Meta allows after the customer&apos;s last message.
      </p>

      <h2>Other data we process</h2>
      <ul>
        <li>Staff account information (name, email, role) for Agency team members who log in</li>
        <li>Business records the Agency enters directly: leads, bookings, pilgrim and traveller details, documents, and payments</li>
        <li>Usage and diagnostic logs needed to operate and secure the Platform</li>
      </ul>

      <h2>How we use this data</h2>
      <p>
        Solely to operate the Platform for the Agency that owns it: displaying conversations and records to
        that Agency&apos;s own staff, sending and receiving WhatsApp, Messenger and Instagram messages on that Agency&apos;s behalf,
        generating AI replies when enabled, and producing the Agency&apos;s own reports and billing summaries.
        We do not use Agency or customer data for advertising, and we do not sell it to third parties.
      </p>

      <h2>Data retention and deletion</h2>
      <p>
        Data is retained for as long as the Agency&apos;s account is active, or as required by applicable
        law. An Agency may disconnect its WhatsApp number, Facebook Page or Instagram account at any time from Settings, which stops
        new messages from being processed and permanently deletes the stored access credentials. If the person who connected an account
        removes our app in their Facebook settings, or asks Meta to delete their data, we disconnect what they connected and delete those
        credentials automatically. See our{" "}
        <a href="/legal/data-deletion">Data Deletion Instructions</a> for how to request removal of specific
        data or an entire account.
      </p>

      <h2>Third parties</h2>
      <p>
        We use Meta&apos;s WhatsApp Business Platform, Messenger Platform and Instagram messaging to send and receive messages,
        Supabase to store data securely, and OpenRouter to reach the AI models that generate replies, transcribe voice notes and search
        the Agency&apos;s own knowledge documents where an Agency enables those features (the reply models are Anthropic&apos;s). Each of
        these providers processes data only as necessary to provide their service to us.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy, or a request regarding your data, can be sent to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </>
  );
}
