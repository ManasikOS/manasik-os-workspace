"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PermissionDenied } from "@/components/ui/tone-badge";

import {
  buildStaffWorkloadRows,
  buildSupplierPerformanceRows,
  buildTaskCategoryRows,
  sortServiceCommitments,
} from "@/lib/data/reports-suppliers";
import { TASK_CATEGORY_LABELS } from "@/lib/data/reports-copy";

import { useReports } from "../../reports-store";
import { formatDate } from "../../utils";

export default function SuppliersTab() {
  const { suppliers } = useReports();

  if (!suppliers) return <PermissionDenied what="Suppliers & Operations reports" />;

  const performance = buildSupplierPerformanceRows(suppliers.suppliers);
  const commitments = sortServiceCommitments(suppliers.suppliers).slice(0, 50);
  const workload = buildStaffWorkloadRows(suppliers.tasks);
  const taskCategories = buildTaskCategoryRows(suppliers.tasks);

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-0 overflow-hidden">
        <CardHeader className="px-5 pt-5">
          <CardTitle className="text-base font-medium">Supplier confirmation performance</CardTitle>
        </CardHeader>
        {performance.length === 0 ? (
          <EmptyState title="No supplier commitments" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Active Commitments</TableHead>
                <TableHead>Confirmed On Time</TableHead>
                <TableHead>Pending</TableHead>
                <TableHead>Late</TableHead>
                <TableHead>Issues</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {performance.map((row) => (
                <TableRow key={row.supplierId}>
                  <TableCell className="font-medium">{row.supplierName}</TableCell>
                  <TableCell className="font-number tabular-nums">{row.activeCommitments}</TableCell>
                  <TableCell className="font-number tabular-nums">{row.confirmedOnTime}</TableCell>
                  <TableCell className="font-number tabular-nums">{row.pending}</TableCell>
                  <TableCell className="font-number tabular-nums">{row.late}</TableCell>
                  <TableCell className="font-number tabular-nums">{row.issues}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <CardHeader className="px-5 pt-5">
          <CardTitle className="text-base font-medium">Service commitments</CardTitle>
        </CardHeader>
        {commitments.length === 0 ? (
          <EmptyState title="No supplier commitments" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commitments.map((row) => (
                <TableRow key={row.commitment_id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{row.group_name}</span>
                      <span className="text-xs text-muted-foreground">{row.group_code}</span>
                    </div>
                  </TableCell>
                  <TableCell>{row.supplier_name}</TableCell>
                  <TableCell>{row.service_label || row.service_category}</TableCell>
                  <TableCell className="text-muted-foreground">{row.reference_code}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.payment_due_at ? formatDate(row.payment_due_at) : "—"}
                  </TableCell>
                  <TableCell>{row.commitment_status}</TableCell>
                  <TableCell className="text-muted-foreground">{row.owner_name ?? "Unassigned"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {suppliers.suppliers.length > 50 && (
          <p className="text-xs text-muted-foreground px-5 pb-4">
            Showing the 50 nearest by due date, of {suppliers.suppliers.length} total commitments.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-0 overflow-hidden">
          <CardHeader className="px-5 pt-5">
            <CardTitle className="text-base font-medium">Guide and staff workload</CardTitle>
          </CardHeader>
          {workload.length === 0 ? (
            <EmptyState title="No tasks assigned" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff Member</TableHead>
                  <TableHead>Groups</TableHead>
                  <TableHead>Open</TableHead>
                  <TableHead>Overdue</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workload.map((row) => (
                  <TableRow key={row.ownerName}>
                    <TableCell className="font-medium">{row.ownerName}</TableCell>
                    <TableCell className="font-number tabular-nums">{row.assignedGroups}</TableCell>
                    <TableCell className="font-number tabular-nums">{row.openTasks}</TableCell>
                    <TableCell className="font-number tabular-nums">{row.overdueTasks}</TableCell>
                    <TableCell className="font-number tabular-nums">{row.completedTasks}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="p-0 overflow-hidden">
          <CardHeader className="px-5 pt-5">
            <CardTitle className="text-base font-medium">Operational task completion</CardTitle>
          </CardHeader>
          {taskCategories.length === 0 ? (
            <EmptyState title="No tasks recorded" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Open</TableHead>
                  <TableHead>In Progress</TableHead>
                  <TableHead>Overdue</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taskCategories.map((row) => (
                  <TableRow key={row.category}>
                    <TableCell className="font-medium">{TASK_CATEGORY_LABELS[row.category] ?? row.category}</TableCell>
                    <TableCell className="font-number tabular-nums">{row.open}</TableCell>
                    <TableCell className="font-number tabular-nums">{row.inProgress}</TableCell>
                    <TableCell className="font-number tabular-nums">{row.overdue}</TableCell>
                    <TableCell className="font-number tabular-nums">{row.completed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
