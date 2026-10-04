import { notFound } from "next/navigation";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToneBadge } from "@/components/ui/tone-badge";
import { Card } from "@/components/ui/card";
import SectionHeading from "@/components/section-heading";
import type { Tone } from "@/lib/ui/tone";

import { loadAgencyDetail, loadAgencyPlanAssignment } from "../actions";
import { AgencyStatusActions } from "./agency-status-actions";
import { AgencyPlanAssignmentCard } from "./agency-plan-card";

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  CANCELLED: "danger",
  INVITED: "info",
  DEACTIVATED: "neutral",
};

export const dynamic = "force-dynamic";

export default async function AgencyDetailPage({
  params,
}: {
  params: Promise<{ agencyId: string }>;
}) {
  const { agencyId } = await params;
  const [agency, planAssignment] = await Promise.all([loadAgencyDetail(agencyId, "Reviewed from the platform console."), loadAgencyPlanAssignment(agencyId)]);
  if (!agency) notFound();

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title={agency.name || "(unnamed agency)"}
        description={agency.slug ?? undefined}
        act={<AgencyStatusActions agencyId={agency.id} status={agency.status} />}
      />

      <div className="flex flex-wrap gap-3">
        <ToneBadge tone={STATUS_TONE[agency.status] ?? "neutral"} label={agency.status} />
        <span className="text-xs text-muted-foreground self-center">
          Created {new Date(agency.createdAt).toLocaleDateString()}
        </span>
      </div>

      <Card className="gap-3 p-5">
        <p className="text-sm font-medium text-foreground">Active departure groups</p>
        <p className="text-2xl font-semibold">{agency.activeGroupCount}</p>
      </Card>
      {planAssignment && <AgencyPlanAssignmentCard agencyId={agency.id} assignment={planAssignment} />}

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-foreground">Staff ({agency.staff.length})</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agency.staff.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.fullName || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{s.email}</TableCell>
                <TableCell>{s.role}</TableCell>
                <TableCell>
                  <ToneBadge tone={STATUS_TONE[s.status] ?? "neutral"} label={s.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
