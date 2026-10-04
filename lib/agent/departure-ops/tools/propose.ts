/**
 * Class 2 — HUMAN_APPROVAL. The single tool through which every proposable
 * change reaches a human — §8 of
 * docs/modules/departure-operations-agent-implementation-plan.md.
 *
 * `payload`'s shape genuinely depends on `kind` (18 different shapes — see
 * `lib/agent/kernel/proposals/kinds/*.ts`). Expressing that precisely as
 * one JSON Schema would need a `oneOf` generated from 18 Zod schemas this
 * codebase has no converter for; instead the outer schema stays loose
 * (`payload` is a free-form object) and the kind's own Zod schema is the
 * real gate, run inside `run()` — a rejected payload comes back as a JSON
 * error the model can read and correct, the same self-correcting loop tool
 * calling already runs on. The tool description below is the model's
 * actual reference for what each kind expects.
 */

import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";

import { PROPOSAL_KINDS, getExecutor } from "@/lib/agent/kernel/proposals/registry";
import type { StagedBuffer } from "@/lib/agent/departure-ops/buffer";

const KIND_REFERENCE = `Payload shape per kind:
- ACCOMMODATION_MARK_CONFIRMED: { accommodationId }
- ACCOMMODATION_SET_REFERENCE: { accommodationId, bookingReference?, supplierName? }
- ACCOMMODATION_SET_VOUCHER: { accommodationId, voucherUrl }
- ACCOMMODATION_UPDATE: { accommodationId, hotelName, supplierName?, supplierId?, bookingReference?, status, checkInDate, checkOutDate, roomCapacity, roomsReserved, mealPlan?, distanceDescription?, notes? }
- TRANSPORT_MARK_CONFIRMED: { transportId }
- TRANSPORT_SET_REFERENCE: { transportId, bookingReference?, supplierName? }
- FLIGHT_UPSERT: { flightId?, direction, status, airline, flightNumber?, pnr?, bookingReference?, originAirportCode, originAirportName, destinationAirportCode, destinationAirportName, departureAt, arrivalAt, cabinClass, seatCapacity, seatsHeld, ticketingDeadline?, supplierName?, notes? }
- FLIGHT_RECORD_TICKETING: { flightId, direction, pnr, bookingReference? }
- FLIGHT_MARK_TICKETS_ISSUED: { flightId }
- GROUP_UPDATE_DETAILS: { groupName?, groupCode?, departureDate?, returnDate?, minimumGroupSize?, salesStatus?, branch?, operationsOwnerName?, primaryGuideName?, visaOwnerName?, financeOwnerName?, localCoordinatorName?, localCoordinatorPhone?, waitlistEnabled?, seatHoldExpiryHours? }
- GROUP_UPDATE_PRICING: { currency?, quadPrice?, triplePrice?, doublePrice?, singlePrice?, childPrice?, infantPrice?, earlyBirdPrice?, advanceDeposit? }
- DEVIATION_DECIDE: { deviationId, approve, note? }
- DEVIATION_MARK_ARRANGED: { deviationId, supplierCommitmentId?, notes? }
- ROOMS_GENERATE: { accommodationId, roomType, occupancyCapacity, count, startingRoomNumber? }
- ROOMS_AUTO_ASSIGN: { accommodationId }
- ROOM_SWAP_SUGGESTED: { deviationId, pilgrimId, roomId, requesterName, requesterCurrentRoomLabel, roommateName, targetRoomLabel }
- BOOKING_SEND_REMINDER: { bookingId, kind: "PAYMENT"|"DOCUMENT", channel: "WHATSAPP"|"SMS"|"EMAIL", message, recipientName, recipientPhone }
- DOCUMENT_REWORK_REQUEST_DRAFTED: { pilgrimId, pilgrimName, documentType: "TICKET"|"VISA", issueSummary, draftMessage, taskTitle, ownerName, ownerId?, dueAt }
- PAYMENT_PLAN_FLAG_FOR_REVIEW: { bookingId, bookingReference, contactName, overdueMilestoneCount (>=2), outstandingBalance, taskTitle, ownerName, ownerId?, dueAt }
- GROUP_MARK_READY: {}
- GROUP_CLOSE_SALES: {}`;

export function createProposeTool(buffer: StagedBuffer, nextStagedId: (kind: string) => string) {
  const proposeAction = betaTool({
    name: "propose_action",
    description:
      "Stages a proposal for a human to approve — the only route to any change a supplier, customer, " +
      "or regulator would learn about (confirmations, itinerary/price changes, messages, marking the " +
      "group ready). Nothing changes until a capable human approves it. Do not repeat a request already " +
      "open or already rejected — check the snapshot's open proposals and rejection history first.\n\n" +
      KIND_REFERENCE,
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...PROPOSAL_KINDS] },
        payload: { type: "object", description: "Shape depends on kind — see the tool description." },
        title: { type: "string", maxLength: 120 },
        rationale: { type: "string", maxLength: 600 },
        evidence: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              tab: { type: "string" },
              filter: { type: "string" },
            },
            required: ["label", "tab"],
            additionalProperties: false,
          },
          maxItems: 5,
        },
        draftBody: { type: "string", maxLength: 2000, description: "A drafted message a human can review and send, when applicable." },
      },
      required: ["kind", "payload", "title", "rationale"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const executor = getExecutor(args.kind);
      if (!executor) {
        return JSON.stringify({ error: `Unknown proposal kind "${args.kind}". Valid kinds: ${PROPOSAL_KINDS.join(", ")}` });
      }
      const parsed = executor.schema.safeParse(args.payload);
      if (!parsed.success) {
        return JSON.stringify({
          error: `Invalid payload for ${args.kind}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        });
      }

      const stagedId = nextStagedId("proposal");
      buffer.proposals.push({
        stagedId,
        input: {
          kind: args.kind,
          payload: parsed.data,
          title: args.title,
          rationale: args.rationale,
          evidence: args.evidence,
          draftBody: args.draftBody ?? null,
        },
      });
      return JSON.stringify({ staged: true, stagedId, requiredCapability: executor.requiredCapability, risk: executor.risk });
    },
  });

  return [proposeAction];
}
