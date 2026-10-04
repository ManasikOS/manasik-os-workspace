"use client";

import React, { createContext, useContext } from "react";

import type { StaffRole } from "@/lib/access/departure-groups-access";

import type { OperationsCapabilities, OperationsSnapshot } from "./types";
import type { ConversationHandoffRecord } from "@/lib/data/conversation-handoff-repository";
import type { CrossPilgrimSupportRow } from "@/lib/data/support-repository";
import type { CrossGroupRoomRow } from "@/lib/data/hotels-repository";

export interface GuidePickerOption {
  id: string;
  fullName: string;
}

interface OperationsContextValue {
  snapshot: OperationsSnapshot;
  currentStaffName: string | null;
  role: StaffRole;
  can: OperationsCapabilities;
  guideOptions: GuidePickerOption[];
  handoffs: ConversationHandoffRecord[];
  /** `null` when the viewer may not see support cases; they are never fetched for them. */
  supportCases: CrossPilgrimSupportRow[] | null;
  canManageSupportCases: boolean;
  /** Whether the viewer may open the Documents / Visa Operations workspaces (gates their blocker cards). */
  canOpenDocuments: boolean;
  canOpenVisa: boolean;
  /** Loaded only while the Rooming board view is open; `null` otherwise. */
  roomingBoardRooms: CrossGroupRoomRow[] | null;
}

const OperationsContext = createContext<OperationsContextValue | null>(null);

export function OperationsProvider({
  children,
  ...value
}: OperationsContextValue & { children: React.ReactNode }) {
  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useOperations(): OperationsContextValue {
  const ctx = useContext(OperationsContext);
  if (!ctx) throw new Error("useOperations must be used within OperationsProvider");
  return ctx;
}
