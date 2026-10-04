"use client";

/**
 * Client-side view over the Leads store the server loaded.
 *
 * Every mutation is now a Server Action in `./actions.ts` backed by
 * `lib/data/leads-repository.ts`; this component's job is just to call the
 * action. Every action calls `revalidatePath("/leads")` on success, so the
 * Server Action response already carries the fresh page — the store must NOT
 * also call `router.refresh()`, which re-ran the whole Leads page (nine
 * unbounded table reads) a second time after every click. The pure
 * mutators in `lib/data/leads.ts` this used to call directly still exist
 * unchanged — they run inside the Server Action now instead of in the browser.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type { LeadCapabilities } from "@/lib/access/leads-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import {
  toLeadListItems,
  type CreateLeadInput,
  type LeadListItem,
  type LogContactInput,
  type MutationOutcome,
} from "@/lib/data/leads";
import type { LeadStore } from "@/lib/data/leads-repository";
import { findDuplicateLead } from "@/lib/data/leads";
import type { FollowUpType, LeadLostReason, LeadRow, LeadStage, StaffRow } from "@/lib/types/leads";
import type { CampaignOption } from "@/lib/data/campaigns-repository";

import {
  addNoteAction,
  assignLeadsAction,
  changeStageAction,
  completeFollowUpAction,
  createLeadAction,
  importLeadsAction,
  logContactAction,
  selectDepartureGroupAction,
  setFollowUpAction,
  type CreateLeadActionResult,
} from "./actions";

interface LeadsContextValue {
  leads: LeadListItem[];
  store: LeadStore;
  /** The instant the current view models were derived against. */
  nowIso: string;
  currentStaffId: string;
  currentStaffName: string;
  role: StaffRole;
  can: LeadCapabilities;
  /** Active Admin/Marketing staff, for owner and follow-up-owner pickers. */
  staffOptions: StaffRow[];
  /** Non-archived campaigns, for the drawer's campaign attribution picker. */
  campaignOptions: CampaignOption[];
  /** True while a Server Action is in flight — disables optimistic double-submits. */
  isPending: boolean;

  /** Submits the Add Lead sheet. Server-validated; returns field errors on failure. */
  createLead: (input: unknown) => Promise<CreateLeadActionResult>;
  changeStage: (
    leadIds: string[],
    stage: LeadStage,
    options?: { lostReason?: LeadLostReason; lostNote?: string; postponedUntil?: string | null },
  ) => Promise<MutationOutcome & { changed: number }>;
  assignLeads: (leadIds: string[], staffId: string) => Promise<MutationOutcome & { changed: number }>;
  logContact: (input: Omit<LogContactInput, "actorName">) => Promise<MutationOutcome>;
  addNote: (leadId: string, note: string) => Promise<MutationOutcome>;
  setFollowUp: (input: {
    leadId: string;
    nextFollowUpAt: string;
    followUpType: FollowUpType;
    followUpOwnerId: string;
  }) => Promise<MutationOutcome>;
  completeFollowUp: (leadId: string) => Promise<MutationOutcome>;
  selectDepartureGroup: (input: {
    leadId: string;
    departureGroupId: string;
    groupLabel: string;
  }) => Promise<MutationOutcome>;
  importLeads: (rows: CreateLeadInput[]) => Promise<{ created: number; failures: string[] }>;
  /** Duplicate lookup against the last-loaded store — good enough for instant UI feedback. */
  findDuplicate: (
    mobile: string,
    email: string,
  ) => { lead: LeadListItem; matchedOn: "mobile" | "email" } | null;
}

/** Fields shown instantly for a single-lead change while the server confirms it. */
type LeadOptimisticFields = Partial<Pick<LeadRow, "stage" | "assigned_to_id" | "assigned_to_name">>;
const NO_OPTIMISTIC_CHANGES: Record<string, LeadOptimisticFields> = {};

const LeadsContext = createContext<LeadsContextValue | null>(null);

export function useLeads(): LeadsContextValue {
  const context = useContext(LeadsContext);
  if (!context) {
    throw new Error("useLeads must be used inside <LeadsProvider>.");
  }
  return context;
}

interface LeadsProviderProps {
  initialStore: LeadStore;
  /** Serialised by the server so the first client render matches the HTML. */
  nowIso: string;
  currentStaffId: string;
  currentStaffName: string;
  role: StaffRole;
  capabilities: LeadCapabilities;
  staffOptions: StaffRow[];
  campaignOptions: CampaignOption[];
  children: React.ReactNode;
}

export function LeadsProvider({
  initialStore,
  nowIso,
  currentStaffId,
  currentStaffName,
  role,
  capabilities,
  staffOptions,
  campaignOptions,
  children,
}: LeadsProviderProps) {
  const [inFlightCount, setInFlightCount] = useState(0);
  const isPending = inFlightCount > 0;
  // Optimistic changes are tagged with the server store they were made against.
  // The moment the server sends a fresh store (a different object), they stop
  // applying on their own — no cleanup effect, and a stale override can never
  // outlive the data that replaces it.
  const [optimistic, setOptimistic] = useState<{
    base: LeadStore;
    byLeadId: Record<string, LeadOptimisticFields>;
  }>({ base: initialStore, byLeadId: NO_OPTIMISTIC_CHANGES });
  // Only used to bump the derived-at clock after a client-only action (like a
  // just-created lead's reference toast) between one `router.refresh()` and the next.
  const [derivedAt, setDerivedAt] = useState(nowIso);

  const activeOptimistic = optimistic.base === initialStore ? optimistic.byLeadId : NO_OPTIMISTIC_CHANGES;

  const displayStore = useMemo<LeadStore>(() => {
    if (Object.keys(activeOptimistic).length === 0) return initialStore;
    return {
      ...initialStore,
      leads: initialStore.leads.map((lead) =>
        activeOptimistic[lead.id] ? { ...lead, ...activeOptimistic[lead.id] } : lead,
      ),
    };
  }, [initialStore, activeOptimistic]);

  const leads = useMemo(
    () => toLeadListItems(displayStore, derivedAt),
    [displayStore, derivedAt],
  );

  /** Bumps the clock the view models are derived against; the data itself arrives with the action's response. */
  const refresh = useCallback(() => {
    setDerivedAt(new Date().toISOString());
  }, []);

  const applyOptimistic = useCallback(
    (leadId: string, fields: LeadOptimisticFields) =>
      setOptimistic((previous) => ({
        base: initialStore,
        byLeadId: {
          ...(previous.base === initialStore ? previous.byLeadId : NO_OPTIMISTIC_CHANGES),
          [leadId]: fields,
        },
      })),
    [initialStore],
  );

  const revertOptimistic = useCallback(
    (leadId: string) =>
      setOptimistic((previous) => {
        if (previous.base !== initialStore || !(leadId in previous.byLeadId)) return previous;
        const { [leadId]: _reverted, ...rest } = previous.byLeadId;
        void _reverted;
        return { base: initialStore, byLeadId: rest };
      }),
    [initialStore],
  );

  /** Marks an action as in flight for `isPending`, whatever way it ends. */
  const trackInFlight = useCallback(async <T,>(run: () => Promise<T>): Promise<T> => {
    setInFlightCount((count) => count + 1);
    try {
      return await run();
    } finally {
      setInFlightCount((count) => count - 1);
    }
  }, []);

  const createLead = useCallback<LeadsContextValue["createLead"]>(
    async (input) => {
      const result = await trackInFlight(() => createLeadAction(input));
      if (result.ok) refresh();
      return result;
    },
    [refresh, trackInFlight],
  );

  const changeStage = useCallback<LeadsContextValue["changeStage"]>(
    async (leadIds, stage, options) => {
      // Single-lead changes show instantly; a bulk change can partly fail, so
      // it waits for the server rather than guessing which rows moved.
      const optimisticLeadId = leadIds.length === 1 ? leadIds[0] : null;
      if (optimisticLeadId) applyOptimistic(optimisticLeadId, { stage });
      const result = await trackInFlight(() => changeStageAction({ leadIds, stage, ...options }));
      if (result.ok) refresh();
      else if (optimisticLeadId) revertOptimistic(optimisticLeadId);
      return result;
    },
    [refresh, applyOptimistic, revertOptimistic, trackInFlight],
  );

  const assignLeads = useCallback<LeadsContextValue["assignLeads"]>(
    async (leadIds, staffId) => {
      const optimisticLeadId = leadIds.length === 1 ? leadIds[0] : null;
      const assignee = staffOptions.find((staff) => staff.id === staffId);
      if (optimisticLeadId && assignee) {
        applyOptimistic(optimisticLeadId, { assigned_to_id: assignee.id, assigned_to_name: assignee.name });
      }
      const result = await trackInFlight(() => assignLeadsAction({ leadIds, staffId }));
      if (result.ok) refresh();
      else if (optimisticLeadId) revertOptimistic(optimisticLeadId);
      return result;
    },
    [refresh, staffOptions, applyOptimistic, revertOptimistic, trackInFlight],
  );

  const logContact = useCallback<LeadsContextValue["logContact"]>(
    async (input) => {
      const result = await trackInFlight(() => logContactAction(input));
      if (result.ok) refresh();
      return result;
    },
    [refresh, trackInFlight],
  );

  const addNote = useCallback<LeadsContextValue["addNote"]>(
    async (leadId, note) => {
      const result = await trackInFlight(() => addNoteAction({ leadId, note }));
      if (result.ok) refresh();
      return result;
    },
    [refresh, trackInFlight],
  );

  const setFollowUp = useCallback<LeadsContextValue["setFollowUp"]>(
    async (input) => {
      const result = await trackInFlight(() => setFollowUpAction(input));
      if (result.ok) refresh();
      return result;
    },
    [refresh, trackInFlight],
  );

  const completeFollowUp = useCallback<LeadsContextValue["completeFollowUp"]>(
    async (leadId) => {
      const result = await trackInFlight(() => completeFollowUpAction(leadId));
      if (result.ok) refresh();
      return result;
    },
    [refresh, trackInFlight],
  );

  const selectDepartureGroup = useCallback<LeadsContextValue["selectDepartureGroup"]>(
    async (input) => {
      const result = await trackInFlight(() => selectDepartureGroupAction(input));
      if (result.ok) refresh();
      return result;
    },
    [refresh, trackInFlight],
  );

  const importLeads = useCallback<LeadsContextValue["importLeads"]>(
    async (rows) => {
      const result = await trackInFlight(() => importLeadsAction(rows));
      if (result.created > 0) refresh();
      return { created: result.created, failures: result.failures };
    },
    [refresh, trackInFlight],
  );

  const findDuplicate = useCallback<LeadsContextValue["findDuplicate"]>(
    (mobile, email) => {
      const match = findDuplicateLead(initialStore.leads, mobile, email);
      if (!match) return null;
      const view = leads.find((lead) => lead.id === match.lead.id);
      return view ? { lead: view, matchedOn: match.matchedOn } : null;
    },
    [leads, initialStore],
  );

  const value = useMemo<LeadsContextValue>(
    () => ({
      leads,
      store: initialStore,
      nowIso: derivedAt,
      currentStaffId,
      currentStaffName,
      role,
      can: capabilities,
      staffOptions,
      campaignOptions,
      isPending,
      createLead,
      changeStage,
      assignLeads,
      logContact,
      addNote,
      setFollowUp,
      completeFollowUp,
      selectDepartureGroup,
      importLeads,
      findDuplicate,
    }),
    [
      leads,
      initialStore,
      derivedAt,
      currentStaffId,
      currentStaffName,
      role,
      capabilities,
      staffOptions,
      campaignOptions,
      isPending,
      createLead,
      changeStage,
      assignLeads,
      logContact,
      addNote,
      setFollowUp,
      completeFollowUp,
      selectDepartureGroup,
      importLeads,
      findDuplicate,
    ],
  );

  return <LeadsContext.Provider value={value}>{children}</LeadsContext.Provider>;
}
