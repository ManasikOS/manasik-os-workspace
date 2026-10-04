import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { capabilitiesForInbox } from "@/lib/access/inbox-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { inboxPageRequestFromSearchParams } from "@/lib/inbox/page-request";

import { InboxFullPage } from "./components/inbox-full-page";

export const metadata: Metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

/**
 * The full-page Inbox. Everything it shows is loaded by the same scoped, agency-checked actions as the header overlay,
 * so this page adds no new data access: it only decides who may open it and which chat the address asks for.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string | string[]; view?: string | string[] }>;
}) {
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).viewModule) notFound();

  const request = inboxPageRequestFromSearchParams(await searchParams);
  return <InboxFullPage conversationId={request.conversationId} view={request.view} />;
}
