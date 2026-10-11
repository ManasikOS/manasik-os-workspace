"use client";

import PageHeader from "@/components/page-header";
import { useProgressRouter } from "@/hooks/use-progress-router";
import type { LeadPackageRow, StaffRow } from "@/lib/types/leads";

import { LeadEditorWorkspace } from "./lead-editor-workspace";

interface LeadEditorScreenProps {
  currentStaffId: string;
  staffOptions: StaffRow[];
  packages: LeadPackageRow[];
}

/**
 * The page that adds a lead: a heading, then the editor. Cancel and Discard
 * go back to the Leads list; a created lead opens in the list's drawer.
 */
export default function LeadEditorScreen({
  currentStaffId,
  staffOptions,
  packages,
}: LeadEditorScreenProps) {
  const router = useProgressRouter();

  return (
    <div className="mx-auto flex w-full flex-col gap-4 pb-6">
      <PageHeader
        title="Add lead"
        subTitle="Capture a new enquiry and schedule the first follow-up"
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Leads", link: "/leads" },
          { title: "New", link: "/leads/new" },
        ]}
        action={null}
      />

      <LeadEditorWorkspace
        currentStaffId={currentStaffId}
        staffOptions={staffOptions}
        packages={packages}
        onClose={() => router.push("/leads")}
        onCreated={(leadId) =>
          router.push(leadId ? `/leads?open=${leadId}` : "/leads")
        }
      />
    </div>
  );
}
