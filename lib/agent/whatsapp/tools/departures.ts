/**
 * Departure availability tools — the agent's read surface for "what trips do
 * you have", "is X still open", "how many seats are left". Every one of
 * these is a thin wrapper over `lib/data/departure-groups-ai.ts`, which is
 * already the customer-safe read model (no cost, no margin, no unconfirmed
 * hotel/flight names, no PII) — this file adds nothing to what that module
 * already strips; it only turns it into tool schemas the model can call.
 *
 * `ctx.db` is the admin client (see AgentContext) — passed through to the
 * `client?: Db` parameter Phase 0 added to `departure-groups-ai.ts` and
 * `departure-groups.ts` specifically so this call path works with no
 * session. See F3 in docs/modules/whatsapp-ai-agent-implementation-plan.md.
 */

import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";

import type { AgentContext } from "@/lib/agent/whatsapp/context";
import {
  canHoldSeats,
  getSellableGroupForAi,
  listSellableGroupsForAi,
} from "@/lib/data/departure-groups-ai";

export function createDepartureTools(ctx: AgentContext) {
  const getUpcomingDepartures = betaTool({
    name: "get_upcoming_departures",
    description:
      "List departure groups currently open for sale, soonest first. Call this when the customer asks " +
      "what trips/departures are available, without naming a specific date or package.",
    inputSchema: {
      type: "object",
      properties: {
        travellers: {
          type: "integer",
          minimum: 1,
          description: "Party size the customer needs seats for. Defaults to 1 if not yet known.",
        },
      },
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const groups = await listSellableGroupsForAi(args.travellers ?? 1, undefined, ctx.db);
      return JSON.stringify(groups.slice(0, 10));
    },
  });

  const searchDepartures = betaTool({
    name: "search_departures",
    description:
      "Search departure groups by package. Call this once the customer has named a specific package, " +
      "journey type, or the agent has matched their request to a package template id.",
    inputSchema: {
      type: "object",
      properties: {
        packageTemplateId: { type: "string", description: "The package template id to filter by." },
        travellers: { type: "integer", minimum: 1 },
      },
      required: ["packageTemplateId"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const groups = await listSellableGroupsForAi(args.travellers ?? 1, args.packageTemplateId, ctx.db);
      return JSON.stringify(groups);
    },
  });

  const getDepartureDetails = betaTool({
    name: "get_departure_details",
    description:
      "Full detail for one departure group the customer has picked — price per room type, itinerary, " +
      "inclusions/exclusions, confirmed hotels/flights if any. Call this once a specific groupId is known.",
    inputSchema: {
      type: "object",
      properties: {
        groupId: { type: "string" },
        travellers: { type: "integer", minimum: 1 },
      },
      required: ["groupId"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const group = await getSellableGroupForAi(args.groupId, args.travellers ?? 1, ctx.db);
      if (!group) {
        return JSON.stringify({ error: "That departure is no longer available for booking." });
      }
      return JSON.stringify(group);
    },
  });

  const checkDepartureAvailability = betaTool({
    name: "check_departure_availability",
    description:
      "Re-checks whether a departure group can still hold the given number of seats, right now. Call " +
      "this immediately before telling the customer a booking can proceed — availability can change " +
      "between the earlier search and this moment.",
    inputSchema: {
      type: "object",
      properties: {
        groupId: { type: "string" },
        travellers: { type: "integer", minimum: 1 },
      },
      required: ["groupId", "travellers"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const result = await canHoldSeats(args.groupId, args.travellers, ctx.db);
      return JSON.stringify(result);
    },
  });

  return [getUpcomingDepartures, searchDepartures, getDepartureDetails, checkDepartureAvailability];
}
