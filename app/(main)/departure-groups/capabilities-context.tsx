"use client";

import { createContext, useContext, type ReactNode } from "react";

import {
  capabilitiesFor,
  type DepartureGroupCapabilities,
  type StaffRole,
} from "@/lib/access/departure-groups-access";

/**
 * The signed-in person's resolved Departure Groups capabilities — their base
 * role's built-in set with any custom-role overrides already merged in on the
 * server (`getCurrentDepartureCapabilities()`).
 *
 * This only decides what the UI shows. The server re-checks every action, so a
 * stale or missing value here can hide or reveal a button but never grant a
 * write.
 */
const DepartureCapabilitiesContext = createContext<DepartureGroupCapabilities | null>(null);

export function DepartureCapabilitiesProvider({
  value,
  children,
}: {
  value: DepartureGroupCapabilities;
  children: ReactNode;
}) {
  return (
    <DepartureCapabilitiesContext.Provider value={value}>
      {children}
    </DepartureCapabilitiesContext.Provider>
  );
}

/**
 * Falls back to the base role's built-in set when no provider is above — a
 * screen that has not been wrapped yet behaves exactly as before.
 */
export function useDepartureCapabilities(role: StaffRole): DepartureGroupCapabilities {
  return useContext(DepartureCapabilitiesContext) ?? capabilitiesFor(role);
}
