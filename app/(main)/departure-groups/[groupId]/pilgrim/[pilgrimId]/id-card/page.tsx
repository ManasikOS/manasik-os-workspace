import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { agencyAssetSignedUrl } from "@/app/(main)/management/settings/branding/logo-storage";
import {
  canRoleOpenGroup,
} from "@/lib/access/departure-groups-access";
import {
  getCurrentDepartureCapabilities,
  getCurrentStaffRole,
  getDepartureGroupDetail,
} from "@/lib/data/departure-groups";
import { getAgencySettings } from "@/lib/data/settings-repository";
import { loadAssignedGroupIds } from "@/lib/data/team-repository";
import { createClient } from "@/utils/supabase/server";

import IdCardStudio, {
  type IdCardStudioData,
} from "../../../components/id-card/id-card-studio";

/**
 * The ID card studio lives inside the app shell like any other group screen —
 * sidebar, header and theme included. Printing is handled by the studio's own
 * print stylesheet rather than by isolating the route, so this is an ordinary
 * page and not a special print surface.
 *
 * Access is decided here in full rather than assumed from the group page the
 * operator arrived from: this is its own URL, and a card carries passport
 * number, phone and rooming in one place.
 */
export default async function PilgrimIdCardPage({
  params,
}: {
  params: Promise<{ groupId: string; pilgrimId: string }>;
}) {
  const { groupId, pilgrimId } = await params;
  const { role, staffId } = await getCurrentStaffRole();

  const can = await getCurrentDepartureCapabilities();
  if (!can.viewModule) notFound();
  if (!can.viewSensitiveTravellerData) notFound();

  const detail = await getDepartureGroupDetail(groupId, role);
  if (!detail) notFound();

  const assignedGroupIds =
    role === "GUIDE" && staffId
      ? await loadAssignedGroupIds(createClient(await cookies()), staffId)
      : [];
  if (!canRoleOpenGroup(detail.group, role, assignedGroupIds)) notFound();

  const pilgrim = detail.manifest.find((row) => row.id === pilgrimId);
  if (!pilgrim) notFound();

  const rooms = pilgrim.roomAssignments.map((assignment) => {
    const accommodation = detail.accommodations.find(
      (a) => a.id === assignment.accommodationId,
    );
    return {
      city: assignment.city,
      hotelName: accommodation?.hotelName ?? "Hotel to be confirmed",
      roomLabel: assignment.roomLabel,
    };
  });

  const supabase = createClient(await cookies());
  const settings = await getAgencySettings(supabase);
  const logoUrl = settings.logo_path
    ? await agencyAssetSignedUrl(settings.logo_path)
    : null;

  const data: IdCardStudioData = {
    groupId,
    agency: {
      name: settings.agency_name,
      logoUrl,
      primaryColor: settings.portal_primary_colour || "#0f766e",
      secondaryColor: settings.portal_secondary_colour,
      whatsapp: settings.primary_whatsapp,
      officeAddress: settings.office_address,
    },
    group: {
      groupCode: detail.group.groupCode,
      groupName: detail.group.groupName,
      departureDate: detail.group.departureDate,
      returnDate: detail.group.returnDate,
      journeyType: detail.group.journeyType,
      packageName: detail.snapshot.packageName,
    },
    pilgrim: {
      fullName: pilgrim.fullName,
      passportNumber: pilgrim.passportNumber,
      phone: pilgrim.phone,
      emergencyContactName: pilgrim.emergencyContactName,
      emergencyContactPhone: pilgrim.emergencyContactPhone,
      bookingReference: pilgrim.bookingReference,
      rooms,
    },
  };

  return <IdCardStudio data={data} />;
}
