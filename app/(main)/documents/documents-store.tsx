"use client";

import React, { createContext, useContext } from "react";

import type { StaffRole } from "@/lib/access/departure-groups-access";

import type { DocumentCapabilities, DocumentListItem } from "./types";

interface DocumentsContextValue {
  documents: DocumentListItem[];
  nowIso: string;
  currentStaffName: string | null;
  role: StaffRole;
  can: DocumentCapabilities;
  aiConfigured: boolean;
}

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

export function DocumentsProvider({
  children,
  ...value
}: DocumentsContextValue & { children: React.ReactNode }) {
  return <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>;
}

export function useDocuments(): DocumentsContextValue {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error("useDocuments must be used within DocumentsProvider");
  return ctx;
}
