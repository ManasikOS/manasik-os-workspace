"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import SearchInput from "@/components/ui/search-input";
import { toast } from "@/components/ui/toast";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/data-table/kpi-card";
import { ExternalLink, UserRound } from "lucide-react";

import { formatDate } from "@/app/(main)/departure-groups/utils";
import type { PortalAccountStatus, PortalPilgrimSummary } from "@/lib/types/portal-access";
import type { Tone } from "@/lib/ui/tone";

import { invitePilgrimToPortalAction, markPilgrimPortalActivatedAction, revokePilgrimPortalAccessAction } from "../actions";

const STATUS_LABELS: Record<PortalAccountStatus, string> = {
  NOT_INVITED: "Not invited",
  INVITED: "Invited",
  ACTIVE: "Active",
  REVOKED: "Revoked",
};

const STATUS_TONE: Record<PortalAccountStatus, Tone> = {
  NOT_INVITED: "neutral",
  INVITED: "info",
  ACTIVE: "success",
  REVOKED: "danger",
};

interface PilgrimPortalViewProps {
  pilgrims: PortalPilgrimSummary[];
  portalActive: boolean;
  canManage: boolean;
}

export default function PilgrimPortalView({ pilgrims, portalActive, canManage }: PilgrimPortalViewProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return pilgrims;
    return pilgrims.filter(
      (p) => p.fullName.toLowerCase().includes(needle) || p.reference.toLowerCase().includes(needle),
    );
  }, [pilgrims, search]);

  const invitedOrActive = pilgrims.filter((p) => p.account?.status === "INVITED" || p.account?.status === "ACTIVE").length;
  const active = pilgrims.filter((p) => p.account?.status === "ACTIVE").length;
  const totalEvents = pilgrims.reduce((sum, p) => sum + p.eventCount, 0);

  const statusOf = (p: PortalPilgrimSummary): PortalAccountStatus => p.account?.status ?? "NOT_INVITED";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pilgrim Portal"
        breadcrumb={[{ title: "Relationships", link: "#" }, { title: "Pilgrim Portal", link: "/relationships/pilgrim-portal" }]}
        subTitle="Portal access lifecycle and engagement, per pilgrim. What the portal shows is configured in Settings → Branding."
        action={
          <Link href="/management/settings/branding" className="text-xs text-primary inline-flex items-center gap-1">
            Portal content settings <ExternalLink className="size-3" />
          </Link>
        }
      />

      {!portalActive && (
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">
            The pilgrim portal is currently deactivated agency-wide (Settings → Branding → Danger Zone). Invites
            below still record intent, but nothing is reachable until it&apos;s turned back on.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Pilgrims" value={String(pilgrims.length)} />
        <KpiCard title="Invited or active" value={String(invitedOrActive)} />
        <KpiCard title="Active" value={String(active)} />
        <KpiCard title="Engagement events" value={String(totalEvents)} />
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder="Search pilgrims…" />

      <Card className="p-0 overflow-x-auto no-scrollbar">
        {filtered.length === 0 ? (
          <EmptyState icon={<UserRound className="size-8" />} title="No pilgrims found" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {["Pilgrim", "Journey status", "Portal status", "Last login", "Events", ""].map((label) => (
                  <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/20">
              {filtered.map((p) => {
                const status = statusOf(p);
                return (
                  <TableRow key={p.pilgrimId} className="hover:bg-muted/40">
                    <TableCell className="px-3 py-3">
                      <p className="text-sm text-foreground">{p.fullName}</p>
                      <p className="text-[11px] text-muted-foreground">{p.reference}</p>
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-foreground">{p.journeyStatus.replace(/_/g, " ")}</TableCell>
                    <TableCell className="px-3 py-3">
                      <ToneBadge tone={STATUS_TONE[status]} label={STATUS_LABELS[status]} />
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                      {p.account?.last_login_at ? formatDate(p.account.last_login_at) : "—"}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs font-number text-foreground">{p.eventCount}</TableCell>
                    <TableCell className="px-3 py-3">
                      {canManage && (
                        <div className="flex items-center gap-1">
                          {(status === "NOT_INVITED" || status === "REVOKED") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                const result = await invitePilgrimToPortalAction(p.pilgrimId);
                                if (!result.ok) return toast.add({ title: result.error ?? "Could not invite" });
                                toast.add({ title: "Invited" });
                              }}
                            >
                              Invite
                            </Button>
                          )}
                          {status === "INVITED" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                const result = await markPilgrimPortalActivatedAction(p.pilgrimId);
                                if (!result.ok) return toast.add({ title: result.error ?? "Could not update" });
                              }}
                            >
                              Mark activated
                            </Button>
                          )}
                          {(status === "INVITED" || status === "ACTIVE") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                const result = await revokePilgrimPortalAccessAction(p.pilgrimId);
                                if (!result.ok) return toast.add({ title: result.error ?? "Could not revoke" });
                              }}
                            >
                              Revoke
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
