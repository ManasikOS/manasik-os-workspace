"use client";

import { useMemo, useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { UsersRound, Plus } from "lucide-react";

import { formatDate } from "@/app/(main)/departure-groups/utils";
import type {
  AudienceSubjectType,
  AudienceType,
  AudienceWithSize,
} from "@/lib/types/audiences";
import type { Tone } from "@/lib/ui/tone";

import { createAudienceAction } from "../actions";

const SUBJECT_LABELS: Record<AudienceSubjectType, string> = {
  LEAD: "Leads",
  PILGRIM: "Pilgrims",
};

const TYPE_LABELS: Record<AudienceType, string> = {
  DYNAMIC: "Dynamic (live filter)",
  STATIC: "Static (saved list)",
};

const TYPE_TONE: Record<AudienceType, Tone> = {
  DYNAMIC: "info",
  STATIC: "neutral",
};

type Filter = "ALL" | AudienceSubjectType;

interface AudiencesListViewProps {
  audiences: AudienceWithSize[];
  canManage: boolean;
}

export default function AudiencesListView({
  audiences,
  canManage,
}: AudiencesListViewProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return audiences.filter((a) => {
      if (filter !== "ALL" && a.subject_type !== filter) return false;
      if (!needle) return true;
      return a.name.toLowerCase().includes(needle);
    });
  }, [audiences, search, filter]);

  const dynamicCount = audiences.filter(
    (a) => a.audience_type === "DYNAMIC",
  ).length;
  const totalReach = audiences.reduce((sum, a) => sum + a.liveCount, 0);
  const contactable = audiences.reduce(
    (sum, a) =>
      sum +
      (a.subject_type === "LEAD" || a.subject_type === "PILGRIM"
        ? a.liveCount
        : 0),
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audiences"
        breadcrumb={[
          { title: "Grow", link: "#" },
          { title: "Audiences", link: "/audiences" },
        ]}
        subTitle="Reusable lead and pilgrim segments, sized live — used by Campaigns and Announcements to target who gets contacted."
        action={
          canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> New Audience
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Audiences" value={String(audiences.length)} />
        <KpiCard title="Dynamic segments" value={String(dynamicCount)} />
        <KpiCard
          title="Static segments"
          value={String(audiences.length - dynamicCount)}
        />
        <KpiCard
          title="Total reach (sum)"
          value={String(totalReach || contactable)}
        />
      </div>

      <Tabs
        value={filter}
        onValueChange={(value) => setFilter(value as Filter)}
      >
        <TabsList>
          {(["ALL", "LEAD", "PILGRIM"] as const).map((key) => (
            <TabsTrigger key={key} value={key}>
              {key === "ALL" ? "All" : SUBJECT_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTableSurface
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search audiences…"
        rowCount={filtered.length}
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={<UsersRound className="size-8" />}
            title="No audiences found"
            description={
              canManage
                ? "Create the first audience to start targeting campaigns."
                : "Try a different search or filter."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {[
                  "Audience",
                  "Subject",
                  "Type",
                  "Size",
                  "Last computed",
                  "Created",
                ].map((label) => (
                  <TableHead
                    key={label}
                    className="h-9 px-3 text-xs font-medium text-muted-foreground"
                  >
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/20">
              {filtered.map((a) => (
                <TableRow
                  key={a.id}
                  className="hover:bg-muted/40 cursor-pointer"
                  onClick={() => router.push(`/audiences/${a.id}`)}
                >
                  <TableCell className="px-3 py-3">
                    <p className="text-sm text-foreground">{a.name}</p>
                    {a.description && (
                      <p className="text-[11px] text-muted-foreground line-clamp-1">
                        {a.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">
                    {SUBJECT_LABELS[a.subject_type]}
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <ToneBadge
                      tone={TYPE_TONE[a.audience_type]}
                      label={TYPE_LABELS[a.audience_type]}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                    {a.liveCount}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                    {a.audience_type === "DYNAMIC"
                      ? "Live"
                      : formatDate(a.computed_at ?? a.updated_at)}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                    {formatDate(a.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTableSurface>

      <CreateAudienceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

function CreateAudienceDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [subjectType, setSubjectType] = useState<AudienceSubjectType>("LEAD");
  const [audienceType, setAudienceType] = useState<AudienceType>("DYNAMIC");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createAudienceAction({
      name,
      description: description || null,
      subjectType,
      audienceType,
      filters: audienceType === "DYNAMIC" ? {} : null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create the audience.");
      return;
    }
    toast.add({ title: "Audience created" });
    onClose();
    if (result.audienceId) router.push(`/audiences/${result.audienceId}`);
    else router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>New audience</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Name</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ramadan Umrah — warm leads"
            />
          </InputGroup>
          <InputGroup>
            <InputGroupAddon align={"block-start"}>
              <InputGroupText>Description</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </InputGroup>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Built from
              </label>
              <Select
                value={subjectType}
                onValueChange={(v) => setSubjectType(v as AudienceSubjectType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LEAD">Leads</SelectItem>
                  <SelectItem value="PILGRIM">Pilgrims</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Type
              </label>
              <Select
                value={audienceType}
                onValueChange={(v) => setAudienceType(v as AudienceType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DYNAMIC">Dynamic (live filter)</SelectItem>
                  <SelectItem value="STATIC">Static (saved list)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {audienceType === "DYNAMIC"
              ? "Filters can be set from the audience's detail screen after it's created."
              : "You'll add members one at a time from the audience's detail screen."}
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? "Creating…" : "Create audience"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
