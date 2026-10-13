"use client";

import PageHeader from "@/components/page-header";
import { useProgressRouter } from "@/hooks/use-progress-router";
import type { StaffRole } from "@/lib/access/departure-groups-access";

import type { PackageTemplateOption } from "../../types";
import { GroupEditorWorkspace } from "./group-editor-workspace";

interface GroupEditorScreenProps {
  templates: PackageTemplateOption[];
  role: StaffRole;
  branches: string[];
  /** From `?template=<id>`, already checked against `templates`. */
  initialTemplateId: string | null;
}

/**
 * The page that creates a departure group: a heading, then the editor. Cancel
 * and Discard go back to the Departure Groups list; a created group opens on
 * its own page.
 */
export default function GroupEditorScreen({
  templates,
  role,
  branches,
  initialTemplateId,
}: GroupEditorScreenProps) {
  const router = useProgressRouter();

  return (
    <div className="mx-auto flex w-full flex-col gap-4 pb-6">
      <PageHeader
        title="Create departure group"
        subTitle="Create a live group from a package template. Defaults are copied and can be adjusted."
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Departure Groups", link: "/departure-groups" },
          { title: "New", link: "/departure-groups/new" },
        ]}
        action={null}
      />

      <GroupEditorWorkspace
        templates={templates}
        role={role}
        branches={branches}
        initialTemplateId={initialTemplateId}
        onClose={() => router.push("/departure-groups")}
        onCreated={(groupId) => {
          router.push(`/departure-groups/${groupId}`);
          router.refresh();
        }}
      />
    </div>
  );
}
