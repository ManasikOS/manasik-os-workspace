"use client";

/**
 * Client-side context for the Payments & Invoices workspace — mirrors
 * `app/(main)/operations/operations-store.tsx`. One route, seven tabs, all
 * reading from the same server-loaded snapshot.
 */

import React, { createContext, useContext } from "react";

import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { FinanceCapabilities } from "@/lib/access/finance-access";

import type { FinanceSnapshot, OwingBookingOption, RefundableBookingOption } from "./types";

interface FinanceContextValue {
  snapshot: FinanceSnapshot;
  owingBookings: OwingBookingOption[];
  refundableBookings: RefundableBookingOption[];
  currentStaffName: string | null;
  role: StaffRole;
  can: FinanceCapabilities;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceProvider({
  children,
  ...value
}: FinanceContextValue & { children: React.ReactNode }) {
  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance(): FinanceContextValue {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error("useFinance must be used within FinanceProvider");
  return ctx;
}
