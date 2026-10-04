"use client";

import PageHeader from "@/components/page-header";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { Button } from "@/components/ui/button";
import { ToneBadge } from "@/components/ui/tone-badge";
import { MessageCircle, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import React, { useState } from "react";

import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { TeamTabId } from "@/lib/access/team-access";
import { accountStatusTone } from "@/lib/data/team";
import type { StaffTaskListItem, TeamMemberProfile } from "@/lib/data/team";
import type { MergedActivityRow } from "@/lib/data/team-repository";
import type { TeamCapabilities } from "../../types";
import { ACCOUNT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, ROLE_LABELS, branchLabel } from "../../utils";
import { reactivateStaffAction } from "../../actions";
import DeactivateStaffDialog from "../../components/deactivate-staff-dialog";
import ExtendAccessDialog from "../../components/extend-access-dialog";
import type { BranchPickerOption, GroupPickerOption } from "../../team-store";
import EditProfileSheet from "../../components/edit-profile-sheet";

import OverviewTab from "./tabs/overview-tab";
import AccessPermissionsTab from "./tabs/access-permissions-tab";
import AssignedGroupsTab from "./tabs/assigned-groups-tab";
import TasksWorkloadTab from "./tabs/tasks-workload-tab";
import ActivitySecurityTab from "./tabs/activity-security-tab";

const TAB_LABELS: Record<TeamTabId, string> = {
  overview: "Overview",
  access: "Access & Permissions",
  groups: "Assigned Groups",
  tasks: "Tasks & Workload",
  activity: "Activity & Security",
};

interface TeamMemberDetailViewProps {
  profile: TeamMemberProfile;
  nowIso: string;
  role: StaffRole;
  can: TeamCapabilities;
  isSelf: boolean;
  visibleTabs: TeamTabId[];
  initialTab: TeamTabId;
  groupOptions: GroupPickerOption[];
  branchOptions: BranchPickerOption[];
  tasks: StaffTaskListItem[];
  activity: MergedActivityRow[];
  hasAdminClient: boolean;
}

const TeamMemberDetailView = ({
  profile,
  nowIso,
  can,
  isSelf,
  visibleTabs,
  initialTab,
  groupOptions,
  branchOptions,
  tasks,
  activity,
  hasAdminClient,
}: TeamMemberDetailViewProps) => {
  const { member } = profile;
  const [tab, setTab] = useState<TeamTabId>(initialTab);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [extendAccessOpen, setExtendAccessOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  const goToTab = (next: TeamTabId) => {
    setTab(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const reactivate = async () => {
    const result = await reactivateStaffAction({ staffId: member.id });
    if (!result.ok) {
      toast.add({ title: "Could not reactivate", description: result.error });
      return;
    }
    toast.add({ title: "Access restored", description: `${member.fullName} can sign in again.` });
  };

  const renderTab = () => {
    switch (tab) {
      case "overview":
        return <OverviewTab profile={profile} nowIso={nowIso} can={can} isSelf={isSelf} onNavigate={goToTab} />;
      case "access":
        return <AccessPermissionsTab profile={profile} can={can} isSelf={isSelf} />;
      case "groups":
        return <AssignedGroupsTab profile={profile} nowIso={nowIso} can={can} groupOptions={groupOptions} />;
      case "tasks":
        return <TasksWorkloadTab profile={profile} tasks={tasks} />;
      case "activity":
        return (
          <ActivitySecurityTab
            profile={profile}
            nowIso={nowIso}
            can={can}
            isSelf={isSelf}
            activity={activity}
            hasAdminClient={hasAdminClient}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Management", link: "/management/team" },
          { title: "Team", link: "/management/team" },
          { title: member.fullName, link: `/management/team/${member.id}` },
        ]}
        title={member.fullName}
        subTitle={member.jobTitle ?? ROLE_LABELS[member.role]}
        action={
          <div className="flex items-center gap-2">
            {member.whatsapp && (
              <Button
                variant="outline_without_border"
                onClick={() => window.open(`https://wa.me/${member.whatsapp!.replace(/\D/g, "")}`, "_blank")}
              >
                <MessageCircle /> WhatsApp
              </Button>
            )}
            {can.editProfile && (
              <Button variant="secondary" onClick={() => setEditProfileOpen(true)}>
                Edit Profile
              </Button>
            )}
            {((can.deactivateStaff && member.status !== "DEACTIVATED") ||
              (can.editProfile && member.employmentType === "SEASONAL")) && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline_without_border"><MoreVertical /></Button>} />
                <DropdownMenuContent align="end">
                  {can.editProfile && member.employmentType === "SEASONAL" && (
                    <DropdownMenuItem onClick={() => setExtendAccessOpen(true)}>
                      Extend Access
                    </DropdownMenuItem>
                  )}
                  {can.deactivateStaff && member.status !== "DEACTIVATED" && (
                    <DropdownMenuItem onClick={() => setDeactivateOpen(true)} className="text-destructive">
                      Deactivate Access
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {can.deactivateStaff && member.status === "DEACTIVATED" && (
              <Button variant="secondary" onClick={reactivate}>
                Reactivate Access
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={accountStatusTone(member.status)} label={ACCOUNT_STATUS_LABELS[member.status]} />
        <ToneBadge tone="neutral" label={branchLabel(member.branch)} />
        <ToneBadge tone="neutral" label={EMPLOYMENT_TYPE_LABELS[member.employmentType]} />
      </div>

      <div>
        <Tabs value={tab} onValueChange={(next) => goToTab(next as TeamTabId)}>
          <TabsList className="flex-wrap h-auto">
            {visibleTabs.map((id) => (
              <TabsTrigger key={id} value={id}>
                {TAB_LABELS[id]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="min-h-100 mt-5">{renderTab()}</div>
      </div>

      <DeactivateStaffDialog
        member={deactivateOpen ? { id: member.id, fullName: member.fullName } : null}
        onClose={() => setDeactivateOpen(false)}
      />
      <ExtendAccessDialog
        member={extendAccessOpen ? { id: member.id, fullName: member.fullName, accessEndsOn: member.accessEndsOn } : null}
        onClose={() => setExtendAccessOpen(false)}
      />
      <EditProfileSheet
        member={
          editProfileOpen
            ? {
                id: member.id,
                fullName: member.fullName,
                whatsapp: member.whatsapp,
                jobTitle: member.jobTitle,
                branch: member.branch,
                employmentType: member.employmentType,
                accessStartsOn: member.accessStartsOn,
                accessEndsOn: member.accessEndsOn,
              }
            : null
        }
        branchOptions={branchOptions}
        onClose={() => setEditProfileOpen(false)}
      />
    </div>
  );
};

export default TeamMemberDetailView;
