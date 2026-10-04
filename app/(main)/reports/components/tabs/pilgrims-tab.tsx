"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PermissionDenied, ToneBadge } from "@/components/ui/tone-badge";

import {
  buildDocumentCompletionRows,
  buildPassportRiskRows,
  buildVisaStatusRows,
  passportRiskTone,
} from "@/lib/data/reports-pilgrims";
import { VISA_STATUS_GROUP_LABELS } from "@/lib/data/reports-copy";

import { useReports } from "../../reports-store";
import { formatShortDate } from "../../utils";

const PASSPORT_STATUS_LABELS: Record<string, string> = {
  EXPIRED: "Expired",
  AT_RISK: "At Risk",
  OK: "OK",
  UNKNOWN: "No passport on file",
};

export default function PilgrimsTab() {
  const { pilgrims } = useReports();

  if (!pilgrims) return <PermissionDenied what="Pilgrim & Compliance reports" />;

  const documents = buildDocumentCompletionRows(pilgrims.pilgrims);
  const visaStatus = buildVisaStatusRows(pilgrims.pilgrims);
  const passportRisk = buildPassportRiskRows(pilgrims.pilgrims).filter((r) => r.status !== "OK");

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-0 overflow-hidden">
        <CardHeader className="px-5 pt-5">
          <CardTitle className="text-base font-medium">Document completion by group</CardTitle>
        </CardHeader>
        {documents.length === 0 ? (
          <EmptyState title="No active pilgrims" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead>Pilgrims</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Missing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((row) => (
                <TableRow key={row.departureGroupId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{row.groupName}</span>
                      <span className="text-xs text-muted-foreground">{row.groupCode}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-number tabular-nums">{row.pilgrimCount}</TableCell>
                  <TableCell className="font-number tabular-nums">{row.requiredDocuments}</TableCell>
                  <TableCell className="font-number tabular-nums">{row.verifiedDocuments}</TableCell>
                  <TableCell className="font-number tabular-nums">{row.missingDocuments}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <CardHeader className="px-5 pt-5">
          <CardTitle className="text-base font-medium">Visa status by group</CardTitle>
        </CardHeader>
        {visaStatus.length === 0 ? (
          <EmptyState title="No active pilgrims" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                {Object.values(VISA_STATUS_GROUP_LABELS).map((label) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visaStatus.map((row) => (
                <TableRow key={row.departureGroupId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{row.groupName}</span>
                      <span className="text-xs text-muted-foreground">{row.groupCode}</span>
                    </div>
                  </TableCell>
                  {(Object.keys(VISA_STATUS_GROUP_LABELS) as (keyof typeof VISA_STATUS_GROUP_LABELS)[]).map((key) => (
                    <TableCell key={key} className="font-number tabular-nums">
                      {row.counts[key]}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <CardHeader className="px-5 pt-5">
          <CardTitle className="text-base font-medium">Passport validity risk</CardTitle>
        </CardHeader>
        {passportRisk.length === 0 ? (
          <EmptyState title="No passports at risk" description="Every pilgrim on file has valid passport cover." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pilgrim</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Passport Expiry</TableHead>
                <TableHead>Days Remaining</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {passportRisk.map((row) => (
                <TableRow key={row.pilgrimId}>
                  <TableCell className="font-medium">{row.pilgrimName}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{row.groupName}</span>
                      <span className="text-xs text-muted-foreground">{row.groupCode}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.passportExpiry ? formatShortDate(row.passportExpiry) : "Not on file"}
                  </TableCell>
                  <TableCell className="font-number tabular-nums">{row.daysRemaining ?? "—"}</TableCell>
                  <TableCell>
                    <ToneBadge tone={passportRiskTone(row.status)} label={PASSPORT_STATUS_LABELS[row.status]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
