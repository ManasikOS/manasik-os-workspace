import type { Metadata } from "next";

import { colomboDayKey } from "@/lib/date";

export const metadata: Metadata = { title: "Data Deletion Instructions" };

// Must stay a monitored inbox: Meta's reviewer may test it by sending a request here.
const CONTACT_EMAIL = "support@manasikos.com";

export default function DataDeletionPage() {
  return (
    <>
      <h1>Data Deletion Instructions</h1>
      <p>Last updated: {colomboDayKey()}</p>

      <p>
        This page explains how to request deletion of data associated with your use of Hajj &amp; Umrah CRM
        (&quot;the Platform&quot;), including data received through a connected WhatsApp Business number, Facebook Page (Messenger) or Instagram account.
      </p>

      <h2>If you are a travel agency using the Platform</h2>
      <p>You can remove your own data at any time without contacting us:</p>
      <ul>
        <li>
          <strong>Disconnect WhatsApp, Messenger or Instagram</strong> — Settings → Integrations → Disconnect on the
          channel&apos;s card. This immediately stops new messages from being processed and permanently deletes the
          stored access credentials for that connection.
        </li>
        <li>
          <strong>Delete your agency&apos;s account</strong> — contact us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from an email associated with an
          administrator on your account, and we will delete your agency&apos;s records, including
          conversation history, messages, and connected-integration data, within 30 days.
        </li>
      </ul>

      <h2>If you are a customer who messaged an agency on WhatsApp, Messenger or Instagram</h2>
      <p>
        If a travel agency using this Platform has your conversation history, you can request its deletion
        directly from that agency, or by writing to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with the agency in question and, for WhatsApp, your
        phone number, or, for Messenger or Instagram, your profile name or username and roughly when you wrote.
        We will confirm the request with the agency and delete the corresponding conversation data within 30
        days.
      </p>

      <h2>If you removed this app from your Facebook or WhatsApp settings</h2>
      <p>
        Removing the app&apos;s access from Meta&apos;s Business Manager or Facebook Settings revokes our
        ability to send or receive messages on that account immediately. A deauthorization notice disconnects the
        Messenger and Instagram connections you made and permanently deletes their stored access credentials. A Meta
        data-deletion request additionally deletes the linked channel conversations, messages, attachments, and AI run
        records. The deletion request returns a confirmation code you can check on our{" "}
        <a href="/legal/data-deletion/status">status page</a>.
      </p>

      <h2>What gets deleted</h2>
      <p>
        A deletion request removes: stored access credentials (WhatsApp, Messenger and Instagram), conversation and
        message history for the specified number, Facebook Page, Instagram account or customer, and any AI-generated run records tied to that conversation. Business
        records an agency created independently of WhatsApp (leads, bookings, documents) are retained
        separately and are covered by our{" "}
        <a href="/legal/privacy">Privacy Policy</a> instead.
      </p>
    </>
  );
}
