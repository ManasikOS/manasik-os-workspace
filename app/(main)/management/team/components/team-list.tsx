"use client";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { KpiCard, KpiRow } from "@/components/data-table/kpi-card";
import { SavedViewBar } from "@/components/data-table/saved-view-bar";
import { FilterMenu } from "@/components/data-table/filter-menu";
import { DataTable } from "@/components/data-table/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { TONE_STAT_CARD, TONE_TEXT } from "@/lib/ui/tone";
import { CalendarClock, Download, MoreVertical, Plus } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useCallback, useDeferredValue, useMemo, useState } from "react";

import { computeTeamKpis } from "@/lib/data/team";
import { useTeam } from "../team-store";
import {
  EMPTY_TEAM_FILTERS,
  TEAM_SAVED_VIEWS,
  type TeamFilters,
  type TeamMemberListItem,
  type TeamQuickFilter,
  type TeamSavedView,
} from "../types";
import {
  ACCOUNT_STATUS_LABELS,
  BRANCH_LABELS,
  DEFAULT_TEAM_SORT,
  ROLE_LABELS,
  WORKLOAD_BAND_LABELS,
  applyTeamSavedView,
  matchesTeamFilters,
  matchesTeamSearch,
  seasonalAccessExpiringSoon,
  sortTeamMembers,
  type TeamSort,
} from "../utils";
import { buildTeamColumns } from "../team-table/team-columns";
import {
  accessAuditToCsv,
  downloadTextFile,
  teamToCsv,
  timestampedFilename,
} from "../csv";
import { reactivateStaffAction } from "../actions";
import InviteTeamMemberDialog from "./invite-team-member-dialog";
import InvitationHistorySheet from "./invitation-history-sheet";
import RolesPermissionsSheet from "./roles-permissions-sheet";
import DeactivateStaffDialog from "./deactivate-staff-dialog";
import AssignGroupDialog from "./assign-group-dialog";
import ExtendAccessDialog from "./extend-access-dialog";
import ChangeRoleDialog from "./change-role-dialog";
import EditProfileSheet from "./edit-profile-sheet";
import { UserCheck } from "reicon-react";

const TeamList = () => {
  const {
    teamMembers,
    unassignedTaskCount,
    groupOptions: assignableGroupOptions,
    branchOptions,
    nowIso,
    can,
  } = useTeam();
  const router = useRouter();

  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput);

  const [savedView, setSavedView] = useState<TeamSavedView>("All Team Members");
  const [quickFilter, setQuickFilter] = useState<TeamQuickFilter | null>(null);
  const [filters, setFilters] = useState<TeamFilters>(EMPTY_TEAM_FILTERS);
  const [sort, setSort] = useState<TeamSort>(DEFAULT_TEAM_SORT);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitationHistoryOpen, setInvitationHistoryOpen] = useState(false);
  const [rolesPermissionsOpen, setRolesPermissionsOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] =
    useState<TeamMemberListItem | null>(null);
  const [assignGroupTarget, setAssignGroupTarget] =
    useState<TeamMemberListItem | null>(null);
  const [extendAccessTarget, setExtendAccessTarget] =
    useState<TeamMemberListItem | null>(null);
  const [changeRoleTarget, setChangeRoleTarget] =
    useState<TeamMemberListItem | null>(null);
  const [editProfileTarget, setEditProfileTarget] =
    useState<TeamMemberListItem | null>(null);

  const setFilter = (key: keyof TeamFilters, value: string) =>
    setFilters((previous) => ({ ...previous, [key]: value }));

  const reactivate = useCallback(
    async (item: TeamMemberListItem) => {
      const result = await reactivateStaffAction({ staffId: item.id });
      if (!result.ok) {
        toast.add({ title: "Could not reactivate", description: result.error });
        return;
      }
      toast.add({
        title: "Access restored",
        description: `${item.fullName} can sign in again.`,
      });
    },
    [],
  );

  const expiringSoon = useMemo(
    () => teamMembers.filter((m) => seasonalAccessExpiringSoon(m, nowIso)),
    [teamMembers, nowIso],
  );

  const groupOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const member of teamMembers) {
      for (const group of member.primaryGroups)
        seen.set(group.groupId, group.groupName);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [teamMembers]);

  const filtered = useMemo(() => {
    const viewed = applyTeamSavedView(teamMembers, savedView, nowIso);
    return viewed.filter((item) => {
      if (!matchesTeamSearch(item, search)) return false;
      if (!matchesTeamFilters(item, filters, nowIso)) return false;
      if (quickFilter === "activeStaff" && item.status !== "ACTIVE")
        return false;
      if (quickFilter === "pendingInvitations" && item.status !== "INVITED")
        return false;
      if (
        quickFilter === "seasonalGuides" &&
        !(item.role === "GUIDE" && item.employmentType === "SEASONAL")
      )
        return false;
      return true;
    });
  }, [teamMembers, savedView, search, filters, quickFilter, nowIso]);

  const sorted = useMemo(
    () => sortTeamMembers(filtered, sort),
    [filtered, sort],
  );
  const kpis = useMemo(
    () => computeTeamKpis(filtered, nowIso, unassignedTaskCount),
    [filtered, nowIso, unassignedTaskCount],
  );

  const columns = useMemo(
    () =>
      buildTeamColumns(
        {
          onOpen: (item) => router.push(`/management/team/${item.id}`),
          onEdit: (item) => setEditProfileTarget(item),
          onAssignGroup: (item) => setAssignGroupTarget(item),
          onChangeRole: (item) => setChangeRoleTarget(item),
          onExtendAccess: (item) => setExtendAccessTarget(item),
          onDeactivate: (item) => setDeactivateTarget(item),
          onReactivate: reactivate,
        },
        nowIso,
        can,
        sort,
        (next) => setSort(next as TeamSort),
      ),
    [router, nowIso, can, sort, reactivate],
  );

  const exportCsv = () => {
    downloadTextFile(timestampedFilename("team"), teamToCsv(sorted));
  };

  const exportAccessAudit = () => {
    downloadTextFile(
      timestampedFilename("access-audit"),
      accessAuditToCsv(sorted, nowIso),
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Management", link: "/management/team" },
          { title: "Team", link: "/management/team" },
        ]}
        title="Team"
        subTitle="Manage staff access, roles, branch assignment, and operational ownership."
        action={
          <div className="flex items-center gap-2">
            {can.inviteStaff && (
              <Button variant="secondary" onClick={() => setInviteOpen(true)}>
                <Plus /> Invite Team Member
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline_without_border">
                    <MoreVertical />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>More</DropdownMenuLabel>
                {can.viewFullDirectory && (
                  <DropdownMenuItem
                    onClick={() => setRolesPermissionsOpen(true)}
                  >
                    Manage Roles & Permissions
                  </DropdownMenuItem>
                )}
                {can.viewFullDirectory && (
                  <DropdownMenuItem
                    onClick={() => setSavedView("Deactivated Accounts")}
                  >
                    View Deactivated Staff
                  </DropdownMenuItem>
                )}
                {can.inviteStaff && (
                  <DropdownMenuItem
                    onClick={() => setInvitationHistoryOpen(true)}
                  >
                    View Invitation History
                  </DropdownMenuItem>
                )}
                {can.exportTeamList && (
                  <DropdownMenuItem onClick={exportCsv}>
                    <Download /> Export Team List
                  </DropdownMenuItem>
                )}
                {can.exportAccessAudit && (
                  <DropdownMenuItem onClick={exportAccessAudit}>
                    <Download /> Export Access Audit
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {can.editProfile && expiringSoon.length > 0 && (
        <Card className={`gap-2 ${TONE_STAT_CARD.warning}`}>
          <div className="flex items-start gap-2.5">
            <CalendarClock
              className={`size-4 shrink-0 mt-0.5 ${TONE_TEXT.warning}`}
            />
            <div className="flex flex-col gap-2 flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                Seasonal access expiring soon for {expiringSoon.length} team
                member{expiringSoon.length === 1 ? "" : "s"}
              </p>
              <div className="flex flex-wrap gap-2">
                {expiringSoon.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 rounded-md bg-background/60 px-2.5 py-1.5 text-xs"
                  >
                    <span className="text-foreground font-medium">
                      {m.fullName}
                    </span>
                    <span className="text-muted-foreground">
                      ends {m.accessEndsOn}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setExtendAccessTarget(m)}
                    >
                      Extend Access
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <KpiRow>
        <button
          className="text-left"
          onClick={() =>
            setQuickFilter(quickFilter === "activeStaff" ? null : "activeStaff")
          }
        >
          <KpiCard
            icon={<UserCheck className="size-4 text-muted-foreground" />}
            title="Active Team Members"
            value={String(kpis.activeTeamMembers)}
          />
        </button>
        <button
          className="text-left"
          onClick={() =>
            setQuickFilter(
              quickFilter === "pendingInvitations"
                ? null
                : "pendingInvitations",
            )
          }
        >
          <KpiCard
            title="Pending Invitations"
            value={String(kpis.pendingInvitations)}
          />
        </button>
        <button
          className="text-left"
          onClick={() =>
            setQuickFilter(
              quickFilter === "seasonalGuides" ? null : "seasonalGuides",
            )
          }
        >
          <KpiCard
            title="Seasonal Guides Active"
            value={String(kpis.seasonalGuidesActive)}
          />
        </button>
        <button
          className="text-left"
          onClick={() => router.push("/operations?tab=tasks&owner=unassigned")}
        >
          <KpiCard
            title="Unassigned Tasks"
            value={String(kpis.unassignedTasks)}
          />
        </button>
        <button
          className="text-left"
          onClick={() =>
            setSavedView(
              savedView === "No Recent Activity"
                ? "All Team Members"
                : "No Recent Activity",
            )
          }
        >
          <KpiCard
            title="Accounts Needing Review"
            value={String(kpis.accountsNeedingReview)}
            desc="No login in 60+ days"
          />
        </button>
      </KpiRow>

      <SavedViewBar
        views={TEAM_SAVED_VIEWS}
        active={savedView}
        onChange={setSavedView}
      />

      <DataTable<TeamMemberListItem>
        columns={columns}
        data={sorted}
        search={search}
        onSearchChange={setSearchInput}
        searchPlaceholder="Search name, email, WhatsApp…"
        toolbar={
          <FilterMenu<keyof TeamFilters>
            groups={[
              {
                key: "role",
                label: "Role",
                value: filters.role,
                options: Object.entries(ROLE_LABELS).map(([value, label]) => ({
                  value,
                  label,
                })),
              },
              {
                key: "branch",
                label: "Branch",
                value: filters.branch,
                options: Object.entries(BRANCH_LABELS).map(
                  ([value, label]) => ({ value, label }),
                ),
              },
              {
                key: "accountStatus",
                label: "Account Status",
                value: filters.accountStatus,
                options: Object.entries(ACCOUNT_STATUS_LABELS).map(
                  ([value, label]) => ({ value, label }),
                ),
              },
              {
                key: "assignedGroup",
                label: "Assigned Group",
                value: filters.assignedGroup,
                options: groupOptions,
              },
              {
                key: "taskLoad",
                label: "Task Load",
                value: filters.taskLoad,
                options: Object.entries(WORKLOAD_BAND_LABELS).map(
                  ([value, label]) => ({ value, label }),
                ),
              },
              {
                key: "lastActive",
                label: "Last Active",
                value: filters.lastActive,
                options: [
                  {
                    value: "NEEDS_REVIEW",
                    label: "No Recent Activity (60+ days)",
                  },
                ],
              },
            ]}
            onChange={setFilter}
            onClear={() => setFilters(EMPTY_TEAM_FILTERS)}
          />
        }
        onRowClick={(item) => router.push(`/management/team/${item.id}`)}
        getRowId={(item) => item.id}
        resetPageToken={`${savedView}-${search}-${JSON.stringify(filters)}-${quickFilter}`}
        sort={{ field: sort.field, direction: sort.direction }}
        sortFieldByColumnId={{
          teamMember: "fullName",
          role: "role",
          openTasks: "openTaskCount",
          lastActive: "lastActiveAt",
        }}
      />

      <InviteTeamMemberDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
      />
      <InvitationHistorySheet
        open={invitationHistoryOpen}
        onOpenChange={setInvitationHistoryOpen}
      />
      <RolesPermissionsSheet
        open={rolesPermissionsOpen}
        onOpenChange={setRolesPermissionsOpen}
      />
      <DeactivateStaffDialog
        member={
          deactivateTarget
            ? { id: deactivateTarget.id, fullName: deactivateTarget.fullName }
            : null
        }
        onClose={() => setDeactivateTarget(null)}
      />
      <AssignGroupDialog
        member={
          assignGroupTarget
            ? {
                id: assignGroupTarget.id,
                fullName: assignGroupTarget.fullName,
                role: assignGroupTarget.role,
              }
            : null
        }
        groupOptions={assignableGroupOptions}
        onClose={() => setAssignGroupTarget(null)}
      />
      <ExtendAccessDialog
        member={
          extendAccessTarget
            ? {
                id: extendAccessTarget.id,
                fullName: extendAccessTarget.fullName,
                accessEndsOn: extendAccessTarget.accessEndsOn,
              }
            : null
        }
        onClose={() => setExtendAccessTarget(null)}
      />
      <ChangeRoleDialog
        member={
          changeRoleTarget
            ? {
                id: changeRoleTarget.id,
                fullName: changeRoleTarget.fullName,
                role: changeRoleTarget.role,
              }
            : null
        }
        open={changeRoleTarget !== null}
        onClose={() => setChangeRoleTarget(null)}
      />
      <EditProfileSheet
        member={
          editProfileTarget
            ? {
                id: editProfileTarget.id,
                fullName: editProfileTarget.fullName,
                whatsapp: editProfileTarget.whatsapp,
                jobTitle: editProfileTarget.jobTitle,
                branch: editProfileTarget.branch,
                employmentType: editProfileTarget.employmentType,
                accessStartsOn: editProfileTarget.accessStartsOn,
                accessEndsOn: editProfileTarget.accessEndsOn,
              }
            : null
        }
        branchOptions={branchOptions}
        onClose={() => setEditProfileTarget(null)}
      />
    </div>
  );
};

export default TeamList;
