/**
 * Class 0 — READ tools. See §8 of
 * docs/modules/departure-operations-agent-implementation-plan.md. No approval, no
 * staging — these only ever read.
 */

import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";

import { daysBetween } from "@/lib/data/departure-groups-copy";
import { AUTO_SOURCE_HINTS } from "@/lib/data/departure-groups-readiness";
import { buildOpsSnapshot } from "@/lib/agent/departure-ops/snapshot";
import type { DepartureOpsContext } from "@/lib/agent/departure-ops/context";

export function createReadTools(ctx: DepartureOpsContext) {
  const getGroupSnapshot = betaTool({
    name: "get_group_snapshot",
    description:
      "The group's full operational snapshot — readiness, blockers, suppliers, traveller counts, " +
      "open work. Already provided to you at the start of this turn; call this only if you need a " +
      "mid-turn refresh after staging changes that might affect what you propose next.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } as const,
    run: async () => {
      const snapshot = await buildOpsSnapshot(ctx.agencyId, ctx.groupId, ctx.db);
      if (!snapshot) return JSON.stringify({ error: "That departure group no longer exists." });
      return JSON.stringify(snapshot);
    },
  });

  const getReadinessItemDetail = betaTool({
    name: "get_readiness_item_detail",
    description:
      "One readiness item's full detail — owner, due date, notes, evidence, and its recent activity " +
      "trail. Call this before proposing a change that touches a specific checklist item, to see the " +
      "reasoning already recorded against it.",
    inputSchema: {
      type: "object",
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const { data: item, error } = await ctx.db
        .from("departure_group_readiness_items")
        .select("*")
        .eq("id", args.itemId)
        .eq("departure_group_id", ctx.groupId)
        .maybeSingle();
      if (error) throw new Error(`Failed to load readiness item: ${error.message}`);
      if (!item) return JSON.stringify({ error: "That readiness item is not on this group." });

      const { data: activity } = await ctx.db
        .from("departure_group_activity_logs")
        .select("message, created_at, actor_name_snapshot")
        .eq("departure_group_id", ctx.groupId)
        .eq("entity_type", "READINESS_ITEM")
        .eq("entity_id", args.itemId)
        .order("created_at", { ascending: false })
        .limit(5);

      const row = item as { auto_source: string | null; [key: string]: unknown };
      return JSON.stringify({
        ...row,
        movedBy: row.auto_source ? AUTO_SOURCE_HINTS[row.auto_source as keyof typeof AUTO_SOURCE_HINTS] : null,
        recentActivity: activity ?? [],
      });
    },
  });

  const getSupplierContext = betaTool({
    name: "get_supplier_context",
    description:
      "Reliability and open-commitment context for one supplier linked to a hotel or transport route on " +
      "this group. Never returns pricing or payment amounts. Call this when deciding how confident to be " +
      "in a supplier confirmation, or how to word a chase.",
    inputSchema: {
      type: "object",
      properties: { supplierId: { type: "string" } },
      required: ["supplierId"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const { data: supplier, error } = await ctx.db
        .from("suppliers")
        .select("name, supplier_type, status, reliability, reliability_reason, lead_time_days, city, country")
        .eq("id", args.supplierId)
        .maybeSingle();
      if (error) throw new Error(`Failed to load supplier: ${error.message}`);
      if (!supplier) return JSON.stringify({ error: "That supplier no longer exists." });

      const { count: openCommitments } = await ctx.db
        .from("supplier_commitments")
        .select("id", { count: "exact", head: true })
        .eq("supplier_id", args.supplierId)
        .not("status", "in", "(COMPLETED,CANCELLED)");

      return JSON.stringify({ ...supplier, openCommitments: openCommitments ?? 0 });
    },
  });

  const getSimilarGroupHistory = betaTool({
    name: "get_similar_group_history",
    description:
      "How recently departed or completed groups typically resolved a readiness category, measured in " +
      "days before departure the required items in it were actually completed. Use this to set a " +
      "realistic due date on a task or proposal rather than guessing — the agency's own recent history, " +
      "not an assumption.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["FLIGHT", "HOTEL", "TRANSPORT", "PAYMENT", "DOCUMENT", "VISA", "ROOMING", "GUIDE", "MANIFEST"],
        },
        sampleSize: { type: "integer", minimum: 1, maximum: 20, description: "Defaults to 8." },
      },
      required: ["category"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const { data: group } = await ctx.db
        .from("departure_groups")
        .select("package_template_id")
        .eq("id", ctx.groupId)
        .maybeSingle();

      const sampleSize = args.sampleSize ?? 8;
      let pastGroupsQuery = ctx.db
        .from("departure_groups")
        .select("id, departure_date")
        .eq("agency_id", ctx.agencyId)
        .in("group_status", ["DEPARTED", "COMPLETED"])
        .neq("id", ctx.groupId)
        .order("departure_date", { ascending: false })
        .limit(sampleSize * 3); // over-fetch: not every past group will have a completed item in this category

      const templateId = (group as { package_template_id: string | null } | null)?.package_template_id;
      if (templateId) pastGroupsQuery = pastGroupsQuery.eq("package_template_id", templateId);

      const { data: pastGroups, error: groupsError } = await pastGroupsQuery;
      if (groupsError) throw new Error(`Failed to load comparable groups: ${groupsError.message}`);
      if (!pastGroups || pastGroups.length === 0) {
        return JSON.stringify({ sampleSize: 0, note: "No comparable past departures found for this agency." });
      }

      const groupIds = pastGroups.map((g) => (g as { id: string }).id);
      const { data: items, error: itemsError } = await ctx.db
        .from("departure_group_readiness_items")
        .select("departure_group_id, completed_at")
        .in("departure_group_id", groupIds)
        .eq("category", args.category)
        .eq("status", "COMPLETE")
        .eq("required", true)
        .not("completed_at", "is", null);
      if (itemsError) throw new Error(`Failed to load comparable readiness items: ${itemsError.message}`);

      const departureByGroup = new Map(
        pastGroups.map((g) => [(g as { id: string }).id, (g as { departure_date: string }).departure_date]),
      );
      const daysBeforeDeparture = (items ?? [])
        .map((item) => {
          const row = item as { departure_group_id: string; completed_at: string };
          const departureDate = departureByGroup.get(row.departure_group_id);
          if (!departureDate) return null;
          return daysBetween(row.completed_at.slice(0, 10), departureDate);
        })
        .filter((v): v is number => v !== null)
        .slice(0, sampleSize);

      if (daysBeforeDeparture.length === 0) {
        return JSON.stringify({ sampleSize: 0, note: `No completed ${args.category} items found on comparable departures.` });
      }

      const sorted = [...daysBeforeDeparture].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const average = Math.round(daysBeforeDeparture.reduce((a, b) => a + b, 0) / daysBeforeDeparture.length);

      return JSON.stringify({
        category: args.category,
        sampleSize: daysBeforeDeparture.length,
        typicalDaysBeforeDepartureMedian: median,
        typicalDaysBeforeDepartureAverage: average,
      });
    },
  });

  const getFlaggedDocumentIssues = betaTool({
    name: "get_flagged_document_issues",
    description:
      "Pilgrims on this group whose ticket or visa AI review found a WARNING or CRITICAL issue (a name " +
      "mismatch, a PNR mismatch, a missing page) that is still open. Deliberately not in the group " +
      "snapshot — a pilgrim's name only leaves this system through a tool call an operator can see logged, " +
      "never through the always-loaded snapshot. Call this before proposing a DOCUMENT_REWORK_REQUEST_DRAFTED.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } as const,
    run: async () => {
      const { data, error } = await ctx.db
        .from("departure_group_pilgrims")
        .select("id, full_name_snapshot, seat_status, ticket_ai_issues, visa_ai_issues")
        .eq("departure_group_id", ctx.groupId)
        .not("seat_status", "in", "(CANCELLED,WAITLIST)")
        .or("ticket_ai_status.eq.COMPLETE,visa_ai_status.eq.COMPLETE");
      if (error) throw new Error(`Failed to load document issues: ${error.message}`);

      type IssueRow = {
        id: string;
        full_name_snapshot: string;
        ticket_ai_issues: { code: string; severity: string; message: string }[] | null;
        visa_ai_issues: { code: string; severity: string; message: string }[] | null;
      };

      const flagged: { pilgrimId: string; pilgrimName: string; documentType: "TICKET" | "VISA"; severity: string; message: string }[] = [];
      for (const row of (data ?? []) as IssueRow[]) {
        for (const issue of row.ticket_ai_issues ?? []) {
          if (issue.severity === "CRITICAL" || issue.severity === "WARNING") {
            flagged.push({ pilgrimId: row.id, pilgrimName: row.full_name_snapshot, documentType: "TICKET", severity: issue.severity, message: issue.message });
          }
        }
        for (const issue of row.visa_ai_issues ?? []) {
          if (issue.severity === "CRITICAL" || issue.severity === "WARNING") {
            flagged.push({ pilgrimId: row.id, pilgrimName: row.full_name_snapshot, documentType: "VISA", severity: issue.severity, message: issue.message });
          }
        }
      }

      // CRITICAL first, capped — this is a per-turn read, not a manifest export.
      flagged.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "CRITICAL" ? -1 : 1));
      return JSON.stringify({ issues: flagged.slice(0, 10), totalFound: flagged.length });
    },
  });

  const getOverduePaymentAccounts = betaTool({
    name: "get_overdue_payment_accounts",
    description:
      "Bookings on this group with 2 or more overdue payment instalments — the accounts a payment plan " +
      "review is actually about, not just the group's overdue count. Deliberately not in the group " +
      "snapshot, same reasoning as get_flagged_document_issues: a contact name only leaves this system " +
      "through a logged tool call. Call this before proposing a PAYMENT_PLAN_FLAG_FOR_REVIEW.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } as const,
    run: async () => {
      const { data: bookings, error } = await ctx.db
        .from("departure_group_bookings")
        .select("id, booking_reference, primary_contact_name, outstanding_balance")
        .eq("departure_group_id", ctx.groupId)
        .neq("booking_status", "CANCELLED")
        .gt("outstanding_balance", 0);
      if (error) throw new Error(`Failed to load bookings: ${error.message}`);
      if (!bookings || bookings.length === 0) return JSON.stringify({ accounts: [] });

      const bookingIds = bookings.map((b) => (b as { id: string }).id);
      const nowIso = new Date().toISOString();
      const { data: candidateMilestones, error: milestonesError } = await ctx.db
        .from("booking_payment_milestones")
        .select("booking_id, amount, paid_amount")
        .in("booking_id", bookingIds)
        .lt("due_at", nowIso)
        .eq("waived", false);
      if (milestonesError) throw new Error(`Failed to load payment milestones: ${milestonesError.message}`);

      // paid_amount < amount can't be expressed as a PostgREST column filter
      // (it compares two columns, not a column to a literal) — filtered here.
      const overdueCountByBooking = new Map<string, number>();
      for (const row of (candidateMilestones ?? []) as { booking_id: string; amount: number; paid_amount: number }[]) {
        if (row.paid_amount >= row.amount) continue;
        overdueCountByBooking.set(row.booking_id, (overdueCountByBooking.get(row.booking_id) ?? 0) + 1);
      }

      type BookingRow = { id: string; booking_reference: string; primary_contact_name: string; outstanding_balance: number };
      const accounts = (bookings as BookingRow[])
        .map((b) => ({
          bookingId: b.id,
          bookingReference: b.booking_reference,
          contactName: b.primary_contact_name,
          outstandingBalance: b.outstanding_balance,
          overdueMilestoneCount: overdueCountByBooking.get(b.id) ?? 0,
        }))
        .filter((a) => a.overdueMilestoneCount >= 2)
        .sort((a, b) => b.overdueMilestoneCount - a.overdueMilestoneCount)
        .slice(0, 10);

      return JSON.stringify({ accounts });
    },
  });

  const getUnarrangedRoommateRequests = betaTool({
    name: "get_unarranged_roommate_requests",
    description:
      "Open ROOMMATE_REQUEST deviations on this group — who asked to room with whom, their current rooms, " +
      "and whether a requested roommate's room already has a spare bed (a one-move fix) or not (needs a " +
      "human to work out a bigger reshuffle). Deliberately not in the group snapshot, same reasoning as " +
      "the other per-pilgrim read tools. Call this before proposing a ROOM_SWAP_SUGGESTED.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } as const,
    run: async () => {
      const { data: deviations, error } = await ctx.db
        .from("departure_group_pilgrim_deviations")
        .select("id, group_pilgrim_id, detail")
        .eq("departure_group_id", ctx.groupId)
        .eq("deviation_type", "ROOMMATE_REQUEST")
        .in("status", ["REQUESTED", "APPROVED"]);
      if (error) throw new Error(`Failed to load roommate requests: ${error.message}`);
      if (!deviations || deviations.length === 0) return JSON.stringify({ requests: [] });

      type DeviationRow = { id: string; group_pilgrim_id: string; detail: { withPilgrimIds?: string[] } | null };
      const rows = deviations as DeviationRow[];
      const pilgrimIds = [...new Set(rows.flatMap((d) => [d.group_pilgrim_id, ...(d.detail?.withPilgrimIds ?? [])]))];

      const { data: pilgrims, error: pilgrimsError } = await ctx.db
        .from("departure_group_pilgrims")
        .select("id, full_name_snapshot, room_id")
        .in("id", pilgrimIds);
      if (pilgrimsError) throw new Error(`Failed to load pilgrims: ${pilgrimsError.message}`);
      type PilgrimRow = { id: string; full_name_snapshot: string; room_id: string | null };
      const pilgrimsById = new Map((pilgrims as PilgrimRow[]).map((p) => [p.id, p]));

      const roomIds = [...new Set((pilgrims as PilgrimRow[]).map((p) => p.room_id).filter((id): id is string => !!id))];
      const { data: rooms, error: roomsError } = await ctx.db
        .from("departure_group_rooms")
        .select("id, room_number, room_type, occupancy_capacity, assigned_pilgrim_count, status")
        .in("id", roomIds);
      if (roomsError) throw new Error(`Failed to load rooms: ${roomsError.message}`);
      type RoomRow = { id: string; room_number: string | null; room_type: string; occupancy_capacity: number; assigned_pilgrim_count: number; status: string };
      const roomsById = new Map((rooms as RoomRow[]).map((r) => [r.id, r]));

      const requests = rows.map((d) => {
        const requester = pilgrimsById.get(d.group_pilgrim_id);
        const requesterRoom = requester?.room_id ? roomsById.get(requester.room_id) : null;
        const desiredRoommates = (d.detail?.withPilgrimIds ?? [])
          .map((id) => pilgrimsById.get(id))
          .filter((p): p is PilgrimRow => !!p)
          .map((p) => {
            const room = p.room_id ? roomsById.get(p.room_id) : null;
            const alreadyTogether = requester?.room_id && requester.room_id === p.room_id;
            const spareBeds = room && room.status !== "BLOCKED" ? room.occupancy_capacity - room.assigned_pilgrim_count : 0;
            return {
              pilgrimId: p.id,
              pilgrimName: p.full_name_snapshot,
              roomLabel: room ? `${room.room_number ?? "—"} · ${room.room_type}` : "Unassigned",
              roomId: room?.id ?? null,
              spareBeds,
              alreadyTogether: !!alreadyTogether,
            };
          });
        return {
          deviationId: d.id,
          requesterId: d.group_pilgrim_id,
          requesterName: requester?.full_name_snapshot ?? "Unknown",
          requesterRoomLabel: requesterRoom ? `${requesterRoom.room_number ?? "—"} · ${requesterRoom.room_type}` : "Unassigned",
          desiredRoommates,
          // A one-move fix exists when a desired roommate's room has a spare
          // bed and they aren't already together — the requester can simply
          // move there. Anything else (both rooms full, no room assigned
          // yet) needs a human to work out, not a guessed multi-person swap.
          simpleMoveAvailable: desiredRoommates.some((r) => !r.alreadyTogether && r.roomId && r.spareBeds > 0),
        };
      });

      return JSON.stringify({ requests });
    },
  });

  return [
    getGroupSnapshot,
    getReadinessItemDetail,
    getSupplierContext,
    getSimilarGroupHistory,
    getFlaggedDocumentIssues,
    getOverduePaymentAccounts,
    getUnarrangedRoommateRequests,
  ];
}
