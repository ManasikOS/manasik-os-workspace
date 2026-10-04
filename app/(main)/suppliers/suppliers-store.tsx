"use client";

/**
 * Client-side context for the Supplier Directory list — mirrors
 * `app/(main)/pilgrims/pilgrims-store.tsx`. The profile page
 * (`/suppliers/[supplierId]`) does not use this: its tabs call
 * Server Actions directly and refresh via `router.refresh()`.
 */

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { createContext, useContext, useTransition } from "react";

import type { StaffRole } from "@/lib/access/departure-groups-access";

import { createSupplierAction, type CreateSupplierResult } from "./actions";
import type { SupplierCapabilities, SupplierListItem } from "./types";
import type { CreateSupplierInput } from "@/lib/validations/suppliers";

export interface GroupPickerOption {
  id: string;
  groupName: string;
  groupCode: string;
}

interface SuppliersContextValue {
  suppliers: SupplierListItem[];
  groupOptions: GroupPickerOption[];
  nowIso: string;
  currentStaffName: string | null;
  role: StaffRole;
  can: SupplierCapabilities;
  isPending: boolean;
  createSupplier: (input: CreateSupplierInput) => Promise<CreateSupplierResult>;
}

const SuppliersContext = createContext<SuppliersContextValue | null>(null);

export function useSuppliers(): SuppliersContextValue {
  const context = useContext(SuppliersContext);
  if (!context)
    throw new Error("useSuppliers must be used inside <SuppliersProvider>.");
  return context;
}

export function SuppliersProvider({
  suppliers,
  groupOptions,
  nowIso,
  currentStaffName,
  role,
  capabilities,
  children,
}: {
  suppliers: SupplierListItem[];
  groupOptions: GroupPickerOption[];
  nowIso: string;
  currentStaffName: string | null;
  role: StaffRole;
  capabilities: SupplierCapabilities;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const createSupplier = async (input: CreateSupplierInput) => {
    const result = await createSupplierAction(input);
    if (result.ok) startTransition(() => router.refresh());
    return result;
  };

  return (
    <SuppliersContext.Provider
      value={{
        suppliers,
        groupOptions,
        nowIso,
        currentStaffName,
        role,
        can: capabilities,
        isPending,
        createSupplier,
      }}
    >
      {children}
    </SuppliersContext.Provider>
  );
}
