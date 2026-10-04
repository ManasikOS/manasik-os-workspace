"use client";

import React, { createContext, useContext } from "react";

import type { StaffRole } from "@/lib/access/departure-groups-access";

import type { VisaCapabilities, VisaListItem } from "./types";

interface VisaContextValue {
  applications: VisaListItem[];
  nowIso: string;
  currentStaffName: string | null;
  role: StaffRole;
  can: VisaCapabilities;
}

const VisaContext = createContext<VisaContextValue | null>(null);

export function VisaProvider({
  children,
  ...value
}: VisaContextValue & { children: React.ReactNode }) {
  return <VisaContext.Provider value={value}>{children}</VisaContext.Provider>;
}

export function useVisa(): VisaContextValue {
  const ctx = useContext(VisaContext);
  if (!ctx) throw new Error("useVisa must be used within VisaProvider");
  return ctx;
}
