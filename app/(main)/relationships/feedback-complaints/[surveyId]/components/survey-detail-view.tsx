"use client";

import { useState } from "react";

import PageHeader from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { Plus } from "lucide-react";

import { formatDateTime } from "@/app/(main)/departure-groups/utils";
import type { SurveyQuestionRow, SurveyResponseWithPilgrim, SurveyRow } from "@/lib/types/feedback";

import { recordSurveyResponseAction, updateSurveyActiveAction } from "../../actions";

interface SurveyDetailViewProps {
  survey: SurveyRow;
  questions: SurveyQuestionRow[];
  responses: SurveyResponseWithPilgrim[];
  canManage: boolean;
}

export default function SurveyDetailView({ survey, questions, responses, canManage }: SurveyDetailViewProps) {
  const [recordOpen, setRecordOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={survey.title}
        breadcrumb={[
          { title: "Relationships", link: "#" },
          { title: "Feedback & Complaints", link: "/relationships/feedback-complaints" },
          { title: survey.title, link: `/relationships/feedback-complaints/${survey.id}` },
        ]}
        subTitle={survey.description ?? undefined}
        action={
          canManage && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setRecordOpen(true)}>
                <Plus className="size-4" /> Record response
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  const result = await updateSurveyActiveAction(survey.id, !survey.is_active);
                  if (!result.ok) return toast.add({ title: result.error ?? "Could not update" });
                }}
              >
                {survey.is_active ? "Deactivate" : "Activate"}
              </Button>
            </div>
          )
        }
      />

      <div className="flex items-center gap-2">
        <Badge variant="secondary">{survey.trigger === "POST_TRIP" ? "Post-trip" : "Manual"}</Badge>
        <ToneBadge tone={survey.is_active ? "success" : "neutral"} label={survey.is_active ? "Active" : "Inactive"} />
      </div>

      <Card className="p-4">
        <p className="text-sm font-medium text-foreground mb-2">Questions</p>
        <ul className="flex flex-col gap-1">
          {questions.map((q) => (
            <li key={q.id} className="text-xs text-muted-foreground">
              {q.question_text} <span className="text-muted-foreground/70">({q.question_type.replace(/_/g, " ")})</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-0 overflow-x-auto no-scrollbar">
        {responses.length === 0 ? (
          <EmptyState title="No responses recorded yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {["Pilgrim", "Score", "Recorded by", "Submitted"].map((label) => (
                  <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/20">
              {responses.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="px-3 py-3 text-sm text-foreground">{r.pilgrimName}</TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-foreground">
                    {r.overall_score !== null ? r.overall_score.toFixed(1) : "—"}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-muted-foreground">{r.recorded_by_name}</TableCell>
                  <TableCell className="px-3 py-3 text-xs text-muted-foreground">{formatDateTime(r.submitted_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <RecordResponseDialog
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        surveyId={survey.id}
        questions={questions}
      />
    </div>
  );
}

function RecordResponseDialog({
  open,
  onClose,
  surveyId,
  questions,
}: {
  open: boolean;
  onClose: () => void;
  surveyId: string;
  questions: SurveyQuestionRow[];
}) {
  const [pilgrimId, setPilgrimId] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await recordSurveyResponseAction({
      surveyId,
      pilgrimId,
      departureGroupId: null,
      answers: questions.map((q) => {
        const raw = answers[q.id] ?? "";
        const isRating = q.question_type === "RATING_1_5" || q.question_type === "RATING_NPS_0_10";
        return {
          questionId: q.id,
          answerRating: isRating && raw !== "" ? Number(raw) : null,
          answerText: !isRating ? raw || null : null,
        };
      }),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not record response.");
      return;
    }
    toast.add({ title: "Response recorded" });
    setPilgrimId("");
    setAnswers({});
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg!">
        <DialogHeader><DialogTitle>Record a response</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2 max-h-[60vh] overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Pilgrim ID</label>
            <Input value={pilgrimId} onChange={(e) => setPilgrimId(e.target.value)} placeholder="from the pilgrim record's URL" />
          </div>
          {questions.map((q) => (
            <div key={q.id} className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{q.question_text}</label>
              {q.question_type === "RATING_1_5" ? (
                <Select value={answers[q.id] ?? ""} onValueChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v ?? "" }))}>
                  <SelectTrigger><SelectValue placeholder="Select a rating" /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : q.question_type === "RATING_NPS_0_10" ? (
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                />
              ) : q.question_type === "YES_NO" ? (
                <Select value={answers[q.id] ?? ""} onValueChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v ?? "" }))}>
                  <SelectTrigger><SelectValue placeholder="Yes or no" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input value={answers[q.id] ?? ""} onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))} />
              )}
            </div>
          ))}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !pilgrimId.trim()}>{submitting ? "Saving…" : "Save response"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
