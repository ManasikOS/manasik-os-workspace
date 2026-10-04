"use client";

import { useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { ChevronLeft } from "lucide-react";

import type { PortalDocument, PortalItineraryEvent, PortalVoucher } from "@/lib/data/pilgrim-portal-repository";

const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  NOT_SUBMITTED: "Not submitted",
  SUBMITTED: "Submitted — under review",
  VERIFIED: "Verified",
  REJECTED: "Needs correction",
  NOT_APPLICABLE: "Not applicable",
};

type TabKey = "itinerary" | "documents";

export default function PortalGroupView({
  groupName,
  groupCode,
  itinerary,
  documents,
  vouchers,
}: {
  groupName: string;
  groupCode: string;
  itinerary: PortalItineraryEvent[];
  documents: PortalDocument[];
  vouchers: PortalVoucher[];
}) {
  const [tab, setTab] = useState<TabKey>(itinerary.length > 0 ? "itinerary" : "documents");

  const byDay = new Map<number, PortalItineraryEvent[]>();
  for (const event of itinerary) {
    const list = byDay.get(event.dayNumber) ?? [];
    list.push(event);
    byDay.set(event.dayNumber, list);
  }

  const voucherByEvent = new Map(vouchers.filter((v) => v.itineraryEventId).map((v) => [v.itineraryEventId, v]));

  return (
    <div className="flex flex-col gap-4">
      <Link href="/portal" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-3.5" /> Back
      </Link>

      <div>
        <h1 className="text-lg font-medium text-foreground">{groupName}</h1>
        <p className="text-xs text-muted-foreground">{groupCode}</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="itinerary">Itinerary</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "itinerary" && (
        <div className="flex flex-col gap-4">
          {byDay.size === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-muted-foreground">Your itinerary hasn&apos;t been published yet.</p>
            </Card>
          ) : (
            [...byDay.entries()].sort(([a], [b]) => a - b).map(([dayNumber, events]) => (
              <Card key={dayNumber} className="p-4 flex flex-col gap-2">
                <p className="text-sm font-medium text-foreground">
                  Day {dayNumber}{events[0]?.dayTitle ? ` — ${events[0].dayTitle}` : ""}
                </p>
                <div className="flex flex-col gap-2">
                  {events.map((event) => {
                    const voucher = voucherByEvent.get(event.id);
                    return (
                      <div key={event.id} className="flex gap-3 text-xs">
                        <span className="text-muted-foreground w-14 shrink-0">{event.startTime ?? "—"}</span>
                        <div>
                          <p className="text-foreground">{event.title}</p>
                          {event.location && <p className="text-muted-foreground">{event.location}</p>}
                          {event.pilgrimFacingNotes && <p className="text-muted-foreground mt-0.5">{event.pilgrimFacingNotes}</p>}
                          {voucher && (
                            <p className="text-primary mt-0.5 font-number">
                              Voucher: {voucher.voucherCode} ({voucher.status.toLowerCase()})
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === "documents" && (
        <div className="flex flex-col gap-2">
          {documents.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-muted-foreground">No documents are listed for this trip yet.</p>
            </Card>
          ) : (
            documents.map((doc) => (
              <Card key={doc.id} className="p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-foreground">{doc.name}</p>
                  <p className="text-[11px] text-muted-foreground">{doc.category}</p>
                </div>
                <Badge variant={doc.status === "VERIFIED" ? "default" : "secondary"}>
                  {DOCUMENT_STATUS_LABELS[doc.status] ?? doc.status}
                </Badge>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
