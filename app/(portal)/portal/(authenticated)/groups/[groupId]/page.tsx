import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { getPortalItinerary, listPortalDocuments, listPortalVouchers } from "@/lib/data/pilgrim-portal-repository";
import { createClient } from "@/utils/supabase/server";

import PortalGroupView from "./components/portal-group-view";

export default async function PortalGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const supabase = createClient(await cookies());

  // RLS alone decides what comes back for this pilgrim — a groupId that
  // isn't theirs simply returns nothing on both queries below, not an error.
  const { data: group } = await supabase
    .from("departure_groups")
    .select("id, group_name, group_code, departure_date")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) notFound();

  const [itinerary, documents, vouchers] = await Promise.all([
    getPortalItinerary(supabase, groupId),
    listPortalDocuments(supabase, groupId),
    listPortalVouchers(supabase, groupId),
  ]);

  return (
    <PortalGroupView
      groupName={group.group_name}
      groupCode={group.group_code}
      itinerary={itinerary}
      documents={documents}
      vouchers={vouchers}
    />
  );
}
