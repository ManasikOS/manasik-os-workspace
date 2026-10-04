"use client";

/**
 * Client-side context for the Team list — mirrors
 * `app/(main)/suppliers/suppliers-store.tsx`. The profile page
 * (`/management/team/[userId]`) does not use this: its tabs call Server
 * Actions directly and refresh via `router.refresh()`.
 */

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { createContext, useContext, useTransition } from "react";

import type { StaffRole } from "@/lib/access/departure-groups-access";

import {
  inviteTeamMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
  type InviteTeamMemberResult,
  type TeamActionResult,
} from "./actions";
import type {
  TeamCapabilities,
  TeamInvitationListItem,
  TeamMemberListItem,
} from "./types";
import type { InviteStaffInput } from "@/lib/validations/team";

export interface GroupPickerOption {
  id: string;
  groupName: string;
  groupCode: string;
}

/** An agency's active branches, for the branch picker on Invite / Edit Profile (H2). */
export interface BranchPickerOption {
  id: string;
  name: string;
  code: string;
}

interface TeamContextValue {
  teamMembers: TeamMemberListItem[];
  unassignedTaskCount: number;
  invitationHistory: TeamInvitationListItem[];
  groupOptions: GroupPickerOption[];
  branchOptions: BranchPickerOption[];
  nowIso: string;
  currentStaffName: string | null;
  currentStaffId: string | null;
  role: StaffRole;
  can: TeamCapabilities;
  isPending: boolean;
  inviteTeamMember: (
    input: InviteStaffInput,
  ) => Promise<InviteTeamMemberResult>;
  resendInvitation: (staffId: string) => Promise<InviteTeamMemberResult>;
  revokeInvitation: (staffId: string) => Promise<TeamActionResult>;
}

const TeamContext = createContext<TeamContextValue | null>(null);

export function useTeam(): TeamContextValue {
  const context = useContext(TeamContext);
  if (!context) throw new Error("useTeam must be used inside <TeamProvider>.");
  return context;
}

export function TeamProvider({
  teamMembers,
  unassignedTaskCount,
  invitationHistory,
  groupOptions,
  branchOptions,
  nowIso,
  currentStaffName,
  currentStaffId,
  role,
  capabilities,
  children,
}: {
  teamMembers: TeamMemberListItem[];
  unassignedTaskCount: number;
  invitationHistory: TeamInvitationListItem[];
  groupOptions: GroupPickerOption[];
  branchOptions: BranchPickerOption[];
  nowIso: string;
  currentStaffName: string | null;
  currentStaffId: string | null;
  role: StaffRole;
  capabilities: TeamCapabilities;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const inviteTeamMember = async (input: InviteStaffInput) => {
    const result = await inviteTeamMemberAction(input);
    if (result.ok) startTransition(() => router.refresh());
    return result;
  };

  const resendInvitation = async (staffId: string) => {
    const result = await resendInvitationAction({ staffId });
    if (result.ok) startTransition(() => router.refresh());
    return result;
  };

  const revokeInvitation = async (staffId: string) => {
    const result = await revokeInvitationAction({ staffId });
    if (result.ok) startTransition(() => router.refresh());
    return result;
  };

  return (
    <TeamContext.Provider
      value={{
        teamMembers,
        unassignedTaskCount,
        invitationHistory,
        groupOptions,
        branchOptions,
        nowIso,
        currentStaffName,
        currentStaffId,
        role,
        can: capabilities,
        isPending,
        inviteTeamMember,
        resendInvitation,
        revokeInvitation,
      }}
    >
      {children}
    </TeamContext.Provider>
  );
}
