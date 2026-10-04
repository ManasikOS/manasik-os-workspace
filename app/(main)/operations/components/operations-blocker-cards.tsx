"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import { ToneBadge } from "@/components/ui/tone-badge";
import SectionHeading from "@/components/section-heading";

import { deriveOperationsBlockerCards } from "../blocker-cards";
import { useOperations } from "../operations-store";
import type { OperationsTabId } from "../types";

/**
 * "What needs attention" — one card per blocker type the viewer may act on.
 * Each card only opens the queue that resolves it; it never shows a
 * mini-workflow of its own.
 */
export default function OperationsBlockerCards({
  onOpenTab,
}: {
  onOpenTab: (tab: OperationsTabId) => void;
}) {
  const { snapshot, supportCases, canOpenDocuments, canOpenVisa } = useOperations();
  const [now] = useState(() => Date.now());

  const cards = useMemo(
    () =>
      deriveOperationsBlockerCards({
        flights: snapshot.flights,
        accommodations: snapshot.accommodations,
        transports: snapshot.transports,
        groups: snapshot.groups,
        supportCases,
        canOpenDocuments,
        canOpenVisa,
        now,
      }),
    [snapshot, supportCases, canOpenDocuments, canOpenVisa, now],
  );

  return (
    <div className="flex flex-col gap-3">
      <SectionHeading title="What needs attention" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const body = (
            <Card className="h-full gap-1 transition-colors hover:bg-muted/40">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{card.label}</p>
                <ToneBadge
                  tone={card.count > 0 ? "warning" : "success"}
                  label={card.count > 0 ? String(card.count) : "Clear"}
                />
              </div>
              <p className="text-xs text-muted-foreground">{card.hint}</p>
            </Card>
          );
          return "href" in card.destination ? (
            <Link key={card.id} href={card.destination.href} className="block">
              {body}
            </Link>
          ) : (
            <button
              key={card.id}
              type="button"
              className="block text-left"
              onClick={() => onOpenTab((card.destination as { tab: OperationsTabId }).tab)}
            >
              {body}
            </button>
          );
        })}
      </div>
    </div>
  );
}
