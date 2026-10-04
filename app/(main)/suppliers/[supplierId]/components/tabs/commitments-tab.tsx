"use client";

import { DataTable } from "@/components/data-table/data-table";
import { toast } from "@/components/ui/toast";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useDeferredValue, useMemo, useState } from "react";

import { confirmCommitmentAction, updateCommitmentStatusAction } from "../../../actions";
import type { SupplierCapabilities, SupplierCommitmentRow, SupplierProfile } from "../../../types";
import { buildCommitmentColumns } from "../commitments-columns";
import UploadEvidenceDialog from "../upload-evidence-dialog";

interface CommitmentsTabProps {
  profile: SupplierProfile;
  nowIso: string;
  can: SupplierCapabilities;
}

export default function CommitmentsTab({ profile, nowIso, can }: CommitmentsTabProps) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput);
  const [evidenceTarget, setEvidenceTarget] = useState<SupplierCommitmentRow | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return profile.commitments;
    const q = search.trim().toLowerCase();
    return profile.commitments.filter(
      (c) =>
        (c.service_label ?? "").toLowerCase().includes(q) ||
        (c.booking_reference ?? "").toLowerCase().includes(q) ||
        c.reference_code.toLowerCase().includes(q),
    );
  }, [profile.commitments, search]);

  const confirm = async (commitment: SupplierCommitmentRow) => {
    const result = await confirmCommitmentAction({ commitmentId: commitment.id });
    if (!result.ok) {
      toast.add({ title: "Could not confirm", description: result.error });
      return;
    }
    toast.add({ title: "Commitment confirmed", description: "The linked group service and readiness have been updated." });
  };

  const dispute = async (commitment: SupplierCommitmentRow) => {
    const result = await updateCommitmentStatusAction({ commitmentId: commitment.id, status: "DISPUTED" });
    if (!result.ok) {
      toast.add({ title: "Could not update status", description: result.error });
      return;
    }
    toast.add({ title: "Commitment marked disputed" });
  };

  const columns = useMemo(
    () =>
      buildCommitmentColumns(
        {
          onOpenGroup: (item) => router.push(`/departure-groups/${item.departure_group_id}`),
          onUploadEvidence: (item) => setEvidenceTarget(item),
          onConfirm: confirm,
          onDispute: dispute,
        },
        nowIso,
        can.viewCosts,
        can.confirmCommitment,
        can.uploadEvidence,
        can.disputeCommitment,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, nowIso, can.viewCosts, can.confirmCommitment, can.uploadEvidence, can.disputeCommitment],
  );

  return (
    <div className="flex flex-col gap-4">
      <DataTable<SupplierCommitmentRow>
        columns={columns}
        data={filtered}
        search={search}
        onSearchChange={setSearchInput}
        searchPlaceholder="Search commitments by service, reference…"
        onRowClick={(item) => router.push(`/departure-groups/${item.departure_group_id}`)}
        getRowId={(item) => item.id}
        emptyMessage="No commitments recorded for this supplier yet."
      />

      <UploadEvidenceDialog supplierId={profile.supplier.id} commitment={evidenceTarget} onClose={() => setEvidenceTarget(null)} />
    </div>
  );
}
