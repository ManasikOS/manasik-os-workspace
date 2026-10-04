import type { CrossPilgrimSupportRow } from "@/lib/data/support-repository";
import type { OperationsSnapshot } from "@/lib/types/operations";

import type { OperationsTabId } from "./types";
import { summariseSupportCases } from "./support-cases";

/**
 * Overview blocker cards: one count per kind of problem that can stop a group,
 * each linking to the queue that resolves it. A card is derived only for what
 * the viewer may open, so the Overview never becomes a parallel workflow or a
 * way to see counts from a workspace the role cannot enter.
 */

export interface BlockerCardSource {
  flights: Pick<OperationsSnapshot["flights"][number], "riskState">[];
  accommodations: Pick<OperationsSnapshot["accommodations"][number], "roomingTone">[];
  transports: Pick<OperationsSnapshot["transports"][number], "warnings">[];
  groups: Pick<OperationsSnapshot["groups"][number], "documentsMissingCount" | "visaPendingCount">[];
  /** `null` when the viewer may not see support cases. */
  supportCases: CrossPilgrimSupportRow[] | null;
  canOpenDocuments: boolean;
  canOpenVisa: boolean;
  now: number;
}

export type BlockerCardDestination = { tab: OperationsTabId } | { href: string };

export interface OperationsBlockerCard {
  id: "support" | "flights" | "rooming" | "transport" | "documents" | "visa";
  label: string;
  hint: string;
  count: number;
  destination: BlockerCardDestination;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export function deriveOperationsBlockerCards(input: BlockerCardSource): OperationsBlockerCard[] {
  const cards: OperationsBlockerCard[] = [];

  if (input.supportCases) {
    cards.push({
      id: "support",
      label: "Urgent support cases",
      hint: "Urgent cases still open or in progress",
      count: summariseSupportCases(input.supportCases, input.now).urgentUnresolved,
      destination: { tab: "support" },
    });
  }

  cards.push(
    {
      id: "flights",
      label: "Flights at risk",
      hint: "Deadline, seat or passenger-name problems",
      count: input.flights.filter((flight) => flight.riskState !== "OK").length,
      destination: { tab: "flights" },
    },
    {
      id: "rooming",
      label: "Stays with rooming gaps",
      hint: "Hotel stays where rooms are not fully assigned",
      count: input.accommodations.filter((stay) => stay.roomingTone !== "success").length,
      destination: { tab: "accommodation" },
    },
    {
      id: "transport",
      label: "Transport with warnings",
      hint: "Missing driver, capacity or pickup problems",
      count: input.transports.filter((movement) => movement.warnings.length > 0).length,
      destination: { tab: "transport" },
    },
  );

  if (input.canOpenDocuments) {
    cards.push({
      id: "documents",
      label: "Missing documents",
      hint: "Open the Documents workspace to review them",
      count: sum(input.groups.map((group) => group.documentsMissingCount)),
      destination: { href: "/documents" },
    });
  }

  if (input.canOpenVisa) {
    cards.push({
      id: "visa",
      label: "Visas pending",
      hint: "Open Visa Operations to progress them",
      count: sum(input.groups.map((group) => group.visaPendingCount)),
      destination: { href: "/visa" },
    });
  }

  return cards;
}
