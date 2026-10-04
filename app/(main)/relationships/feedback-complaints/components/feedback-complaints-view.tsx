"use client";

import { useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import PageHeader from "@/components/page-header";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
import { MessageSquareWarning, Plus, Star } from "lucide-react";

import { formatDateTime } from "@/app/(main)/departure-groups/utils";
import { updateSupportRequestStatusAction } from "@/app/(main)/pilgrims/actions";
import type { CrossPilgrimSupportRow } from "@/lib/data/support-repository";
import type { SurveyQuestionType, SurveyWithStats } from "@/lib/types/feedback";
import type { PilgrimSupportStatus } from "@/lib/types/pilgrims";
import type { Tone } from "@/lib/ui/tone";

import { createSurveyAction } from "../actions";

const STATUS_LABELS: Record<PilgrimSupportStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};

const STATUS_TONE: Record<PilgrimSupportStatus, Tone> = {
  OPEN: "danger",
  IN_PROGRESS: "warning",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

const QUESTION_TYPE_LABELS: Record<SurveyQuestionType, string> = {
  RATING_1_5: "Rating (1–5)",
  RATING_NPS_0_10: "NPS (0–10)",
  YES_NO: "Yes / No",
  TEXT: "Free text",
};

type TabKey = "complaints" | "feedback";

interface FeedbackComplaintsViewProps {
  complaints: CrossPilgrimSupportRow[];
  surveys: SurveyWithStats[];
  canManage: boolean;
}

export default function FeedbackComplaintsView({ complaints, surveys, canManage }: FeedbackComplaintsViewProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("complaints");
  const [createSurveyOpen, setCreateSurveyOpen] = useState(false);

  const openComplaints = complaints.filter((c) => c.status === "OPEN" || c.status === "IN_PROGRESS").length;
  const totalResponses = surveys.reduce((sum, s) => sum + s.responseCount, 0);
  const scoredSurveys = surveys.filter((s) => s.averageScore !== null);
  const overallAverage =
    scoredSurveys.length > 0
      ? scoredSurveys.reduce((sum, s) => sum + (s.averageScore ?? 0), 0) / scoredSurveys.length
      : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Feedback & Complaints"
        breadcrumb={[{ title: "Relationships", link: "#" }, { title: "Feedback & Complaints", link: "/relationships/feedback-complaints" }]}
        subTitle="Complaints share the same intake/SLA workflow as Support & Incidents; feedback surveys track satisfaction separately."
        action={
          canManage &&
          tab === "feedback" && (
            <Button onClick={() => setCreateSurveyOpen(true)}>
              <Plus /> New survey
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Complaints" value={String(complaints.length)} />
        <KpiCard title="Open complaints" value={String(openComplaints)} />
        <KpiCard title="Survey responses" value={String(totalResponses)} />
        <KpiCard title="Average score" value={overallAverage !== null ? overallAverage.toFixed(1) : "—"} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="complaints">Complaints</TabsTrigger>
          <TabsTrigger value="feedback">Feedback Surveys</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "complaints" && (
        <>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">
              Complaints are logged from a pilgrim&apos;s own Support tab, tagged with category
              &quot;Complaint&quot; — this reuses the same intake, assignment and resolution workflow as{" "}
              Support &amp; Incidents so there is one queue, not two.
            </p>
          </Card>
          <Card className="p-0 overflow-x-auto no-scrollbar">
            {complaints.length === 0 ? (
              <EmptyState icon={<MessageSquareWarning className="size-8" />} title="No complaints logged" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {["Pilgrim", "Complaint", "Group", "Priority", "Logged", "Status", ""].map((label) => (
                      <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {complaints.map((c) => (
                    <TableRow key={c.id} className="hover:bg-muted/40">
                      <TableCell className="px-3 py-3 text-sm text-foreground">{c.pilgrimName}</TableCell>
                      <TableCell className="px-3 py-3">
                        <p className="text-sm text-foreground">{c.title}</p>
                        {c.detail && <p className="text-[11px] text-muted-foreground line-clamp-1">{c.detail}</p>}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-muted-foreground">{c.groupName ?? "—"}</TableCell>
                      <TableCell className="px-3 py-3 text-xs text-foreground">{c.priority}</TableCell>
                      <TableCell className="px-3 py-3 text-xs text-muted-foreground">{formatDateTime(c.createdAt)}</TableCell>
                      <TableCell className="px-3 py-3">
                        {canManage ? (
                          <Select
                            value={c.status}
                            onValueChange={async (v) => {
                              const result = await updateSupportRequestStatusAction({
                                pilgrimId: c.pilgrimId,
                                requestId: c.id,
                                status: v as PilgrimSupportStatus,
                              });
                              if (!result.ok) return toast.add({ title: result.error ?? "Could not update status" });
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs w-[130px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(Object.keys(STATUS_LABELS) as PilgrimSupportStatus[]).map((status) => (
                                <SelectItem key={status} value={status}>{STATUS_LABELS[status]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <ToneBadge tone={STATUS_TONE[c.status]} label={STATUS_LABELS[c.status]} />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}

      {tab === "feedback" && (
        <Card className="p-0 overflow-x-auto no-scrollbar">
          {surveys.length === 0 ? (
            <EmptyState
              icon={<Star className="size-8" />}
              title="No surveys yet"
              description={canManage ? "Create the first satisfaction survey." : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {["Survey", "Trigger", "Responses", "Average score", "Status", ""].map((label) => (
                    <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {surveys.map((s) => (
                  <TableRow
                    key={s.id}
                    className="hover:bg-muted/40 cursor-pointer"
                    onClick={() => router.push(`/relationships/feedback-complaints/${s.id}`)}
                  >
                    <TableCell className="px-3 py-3">
                      <p className="text-sm text-foreground">{s.title}</p>
                      {s.description && <p className="text-[11px] text-muted-foreground line-clamp-1">{s.description}</p>}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-foreground">
                      {s.trigger === "POST_TRIP" ? "Post-trip" : "Manual"}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs font-number text-foreground">{s.responseCount}</TableCell>
                    <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                      {s.averageScore !== null ? s.averageScore.toFixed(1) : "—"}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <ToneBadge tone={s.is_active ? "success" : "neutral"} label={s.is_active ? "Active" : "Inactive"} />
                    </TableCell>
                    <TableCell className="px-3 py-3" />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      <CreateSurveyDialog open={createSurveyOpen} onClose={() => setCreateSurveyOpen(false)} />
    </div>
  );
}

function CreateSurveyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState<"POST_TRIP" | "MANUAL">("POST_TRIP");
  const [questions, setQuestions] = useState<{ questionText: string; questionType: SurveyQuestionType }[]>([
    { questionText: "How satisfied were you with your trip overall?", questionType: "RATING_1_5" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createSurveyAction({
      title,
      description: description || null,
      trigger,
      questions: questions.filter((q) => q.questionText.trim()),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create the survey.");
      return;
    }
    toast.add({ title: "Survey created" });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg!">
        <DialogHeader><DialogTitle>New survey</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2 max-h-[60vh] overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Post-trip satisfaction" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Trigger</label>
            <Select value={trigger} onValueChange={(v) => setTrigger(v as "POST_TRIP" | "MANUAL")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="POST_TRIP">Post-trip</SelectItem>
                <SelectItem value="MANUAL">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground">Questions</label>
            {questions.map((q, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={q.questionText}
                  onChange={(e) =>
                    setQuestions((prev) => prev.map((p, i) => (i === index ? { ...p, questionText: e.target.value } : p)))
                  }
                  placeholder="Question text"
                  className="flex-1"
                />
                <Select
                  value={q.questionType}
                  onValueChange={(v) =>
                    setQuestions((prev) => prev.map((p, i) => (i === index ? { ...p, questionType: v as SurveyQuestionType } : p)))
                  }
                >
                  <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(QUESTION_TYPE_LABELS) as SurveyQuestionType[]).map((t) => (
                      <SelectItem key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setQuestions((prev) => [...prev, { questionText: "", questionType: "RATING_1_5" }])}
            >
              <Plus className="size-3.5" /> Add question
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !title.trim()}>{submitting ? "Creating…" : "Create survey"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
