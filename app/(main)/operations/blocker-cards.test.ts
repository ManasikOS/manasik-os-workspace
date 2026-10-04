import { describe, expect, it } from "vitest";

import type { CrossPilgrimSupportRow } from "@/lib/data/support-repository";

import { deriveOperationsBlockerCards, type BlockerCardSource } from "./blocker-cards";

const NOW = Date.parse("2026-09-27T12:00:00Z");

function source(overrides: Partial<BlockerCardSource> = {}): BlockerCardSource {
  return {
    flights: [{ riskState: "OK" }, { riskState: "OVERDUE" }, { riskState: "SEATS_SHORT" }],
    accommodations: [{ roomingTone: "success" }, { roomingTone: "warning" }],
    transports: [{ warnings: [] }, { warnings: ["No driver"] }],
    groups: [
      { documentsMissingCount: 3, visaPendingCount: 1 },
      { documentsMissingCount: 2, visaPendingCount: 4 },
    ],
    supportCases: [
      { status: "OPEN", priority: "URGENT", slaDueAt: null },
      { status: "RESOLVED", priority: "URGENT", slaDueAt: null },
    ] as CrossPilgrimSupportRow[],
    canOpenDocuments: true,
    canOpenVisa: true,
    now: NOW,
    ...overrides,
  };
}

const byId = (cards: ReturnType<typeof deriveOperationsBlockerCards>, id: string) =>
  cards.find((card) => card.id === id);

describe("deriveOperationsBlockerCards", () => {
  it("counts each blocker and points it at its canonical queue", () => {
    const cards = deriveOperationsBlockerCards(source());
    expect(byId(cards, "flights")).toMatchObject({ count: 2, destination: { tab: "flights" } });
    expect(byId(cards, "rooming")).toMatchObject({ count: 1, destination: { tab: "accommodation" } });
    expect(byId(cards, "transport")).toMatchObject({ count: 1, destination: { tab: "transport" } });
    expect(byId(cards, "support")).toMatchObject({ count: 1, destination: { tab: "support" } });
    expect(byId(cards, "documents")).toMatchObject({ count: 5, destination: { href: "/documents" } });
    expect(byId(cards, "visa")).toMatchObject({ count: 5, destination: { href: "/visa" } });
  });

  it("omits the support card when the viewer has no support access", () => {
    expect(byId(deriveOperationsBlockerCards(source({ supportCases: null })), "support")).toBeUndefined();
  });

  it("omits the documents and visa cards for roles that cannot open those workspaces", () => {
    const cards = deriveOperationsBlockerCards(source({ canOpenDocuments: false, canOpenVisa: false }));
    expect(byId(cards, "documents")).toBeUndefined();
    expect(byId(cards, "visa")).toBeUndefined();
  });

  it("marks a card as clear when nothing is blocked", () => {
    const cards = deriveOperationsBlockerCards(
      source({ flights: [], accommodations: [], transports: [], groups: [], supportCases: [] }),
    );
    expect(cards.every((card) => card.count === 0)).toBe(true);
  });
});
