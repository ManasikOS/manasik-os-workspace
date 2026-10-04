import Link from "next/link";
import { Building2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToneBadge, EmptyState } from "@/components/ui/tone-badge";
import SectionHeading from "@/components/section-heading";
import type { Tone } from "@/lib/ui/tone";

import { loadOperatorSetupSources } from "@/lib/setup/operator-setup-loader";
import { summariseAgencySetup } from "@/lib/setup/operator-setup-progress";

import { listAgencies } from "./actions";
import { OnboardingFunnelPanel } from "./components/onboarding-funnel-panel";

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  CANCELLED: "danger",
};

export const dynamic = "force-dynamic";

export default async function AgenciesPage() {
  const agencies = await listAgencies();
  const setupSources = await loadOperatorSetupSources(
    agencies.map((agency) => agency.id),
    new Map(agencies.map((agency) => [agency.id, agency.staffCount])),
  );

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="Agencies"
        description="Every tenant on the platform."
        act={
          <Link href="/platform/agencies/new">
            <Button>
              <Plus className="size-4" /> New agency
            </Button>
          </Link>
        }
      />

      {agencies.length === 0 ? (
        <EmptyState icon={<Building2 className="size-8" />} title="No agencies yet" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Staff</TableHead>
              <TableHead>Active groups</TableHead>
              <TableHead>Setup</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agencies.map((a) => (
              <TableRow key={a.id} className="cursor-pointer">
                <TableCell>
                  <Link href={`/platform/agencies/${a.id}`} className="font-medium hover:underline">
                    {a.name || "(unnamed)"}
                  </Link>
                  {a.slug && <div className="text-xs text-muted-foreground">{a.slug}</div>}
                </TableCell>
                <TableCell>
                  <ToneBadge tone={STATUS_TONE[a.status] ?? "neutral"} label={a.status} />
                </TableCell>
                <TableCell>{a.staffCount}</TableCell>
                <TableCell>{a.activeGroupCount}</TableCell>
                <TableCell>
                  {(() => {
                    const setup = summariseAgencySetup(a.id, setupSources);
                    return `${setup.doneCount} of ${setup.total}`;
                  })()}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(a.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <OnboardingFunnelPanel />
    </div>
  );
}
