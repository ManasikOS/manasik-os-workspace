"use client";

/**
 * Client-side context for the Pilgrims list — mirrors
 * `app/(main)/leads/leads-store.tsx`. The profile page
 * (`/pilgrims/[pilgrimId]`) does not use this: its tabs call Server Actions
 * directly and refresh via `router.refresh()`, the same pattern
 * `departure-group-detail.tsx` already uses.
 */

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { createContext, useContext, useTransition } from "react";

import type { PilgrimCapabilities } from "@/lib/access/pilgrims-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";

import { createPilgrimAction, type CreatePilgrimResult } from "./actions";
import type { PilgrimListItem } from "./types";

interface PilgrimsContextValue {
  pilgrims: PilgrimListItem[];
  nowIso: string;
  currentStaffName: string | null;
  role: StaffRole;
  can: PilgrimCapabilities;
  isPending: boolean;
  createPilgrim: (input: { fullName: string; whatsappNumber: string; passportNumber?: string; city?: string }) => Promise<CreatePilgrimResult>;
}

const PilgrimsContext = createContext<PilgrimsContextValue | null>(null);

export function usePilgrims(): PilgrimsContextValue {
  const context = useContext(PilgrimsContext);
  if (!context) throw new Error("usePilgrims must be used inside <PilgrimsProvider>.");
  return context;
}

export function PilgrimsProvider({
  pilgrims,
  nowIso,
  currentStaffName,
  role,
  capabilities,
  children,
}: {
  pilgrims: PilgrimListItem[];
  nowIso: string;
  currentStaffName: string | null;
  role: StaffRole;
  capabilities: PilgrimCapabilities;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const createPilgrim = async (input: { fullName: string; whatsappNumber: string; passportNumber?: string; city?: string }) => {
    const result = await createPilgrimAction(input);
    if (result.ok) startTransition(() => router.refresh());
    return result;
  };

  return (
    <PilgrimsContext.Provider
      value={{ pilgrims, nowIso, currentStaffName, role, can: capabilities, isPending, createPilgrim }}
    >
      {children}
    </PilgrimsContext.Provider>
  );
}
