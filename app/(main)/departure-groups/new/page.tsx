import { notFound } from "next/navigation";

import {
  getCurrentDepartureCapabilities,
  getCurrentStaffRole,
  listGroupBranches,
  listPackageTemplateOptions,
} from "@/lib/data/departure-groups";

import GroupEditorScreen from "../components/group-editor/group-editor-screen";

/**
 * Creating a departure group: the full-page editor. Also the deep link the
 * Packages screens use (`/departure-groups/new?template=<id>`).
 */
export default async function NewDepartureGroupPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const [{ role }, can, { template: templateParam }] = await Promise.all([
    getCurrentStaffRole(),
    getCurrentDepartureCapabilities(),
    searchParams,
  ]);
  // A role that cannot start a group must not be able to reach this by URL.
  if (!can.viewModule || !can.createGroup) notFound();

  const [templates, branches] = await Promise.all([
    // Drafts are only ever offered to ADMIN; see `listPackageTemplateOptions()`.
    listPackageTemplateOptions({ includeDrafts: role === "ADMIN" }),
    listGroupBranches(),
  ]);

  // The id is checked against the templates this role can actually see before
  // being trusted, so a stale or tampered id cannot preselect something this
  // person could not otherwise pick from the list.
  const initialTemplateId =
    templateParam && templates.some((template) => template.id === templateParam)
      ? templateParam
      : null;

  return (
    <GroupEditorScreen
      templates={templates}
      role={role}
      branches={branches}
      initialTemplateId={initialTemplateId}
    />
  );
}
