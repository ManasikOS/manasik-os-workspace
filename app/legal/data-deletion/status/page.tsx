import type { Metadata } from "next";

import { readDeletionConfirmationCode } from "@/lib/meta/signed-request";

export const metadata: Metadata = { title: "Data Deletion Request Status" };

// Depends on the confirmation code in the address, so it cannot be prerendered.
export const dynamic = "force-dynamic";

/**
 * Where the `url` returned to Meta's data-deletion callback lands. The confirmation code is stateless (signed with
 * the app secret), so this page tells a request we processed from an invented code without storing anything — and
 * shows no personal data, because the code carries none.
 */
export default async function DataDeletionStatusPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const codeParam = (await searchParams).code;
  const code = typeof codeParam === "string" ? codeParam : null;
  const receivedAt = readDeletionConfirmationCode(code, process.env.META_APP_SECRET ?? "");

  if (!receivedAt) {
    return (
      <>
        <h1>Data Deletion Request Status</h1>
        <p>
          We couldn&apos;t find a deletion request for that confirmation code. Check that you copied the whole link, or read our{" "}
          <a href="/legal/data-deletion">Data Deletion Instructions</a> for how to ask us directly.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Data Deletion Request Status</h1>
      <p>
        <strong>Status: completed.</strong> We received your deletion request on {receivedAt.toUTCString()} (confirmation code{" "}
        <code>{code}</code>).
      </p>
      <h2>What was done</h2>
      <ul>
        <li>
          Every Messenger and Instagram connection made with your Meta account was disconnected, and the access credentials we stored for
          them were permanently deleted. We can no longer send or receive messages through them.
        </li>
      </ul>
      <h2>What was not removed</h2>
      <p>
        Conversations and business records belong to the travel agency that used the Platform, not to the person who connected the account.
        To have a conversation deleted, ask the agency, or follow the steps in our <a href="/legal/data-deletion">Data Deletion Instructions</a>.
      </p>
    </>
  );
}
