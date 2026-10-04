import { cookies } from "next/headers";

import SectionHeading from "@/components/section-heading";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/tone-badge";
import type { UnansweredQuestion } from "@/lib/agent/whatsapp/knowledge/unanswered";
import { getUnansweredKnowledgeTopics, UNANSWERED_LOOKBACK_DAYS } from "@/lib/data/knowledge-unanswered";
import { createClient } from "@/utils/supabase/server";

function formatLastAsked(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export async function UnansweredQuestionsSection({ agencyId }: { agencyId: string }) {
  let questions: UnansweredQuestion[] | null = null;

  try {
    questions = await getUnansweredKnowledgeTopics(createClient(await cookies()), agencyId);
  } catch (error) {
    console.error("Unanswered knowledge questions failed to load:", error);
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        title="Topics the assistant couldn't answer"
        description={`Subjects customers asked about in the last ${UNANSWERED_LOOKBACK_DAYS} days that none of your documents covered. Add a document or write a short policy for the ones that come up most.`}
      />
      <Card className="overflow-hidden p-0">
        {questions === null ? (
          <EmptyState title="We couldn't load this list" description="Reload the page to try again." />
        ) : questions.length === 0 ? (
          <EmptyState
            title="Nothing missing so far"
            description="When a customer asks about something your documents don't cover, the topic will appear here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Topic</TableHead>
                <TableHead className="text-right">Times asked</TableHead>
                <TableHead className="text-right">Last asked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {questions.map((question) => (
                <TableRow key={question.topic}>
                  <TableCell className="font-medium">{question.topic}</TableCell>
                  <TableCell className="text-right font-number">{question.timesAsked}</TableCell>
                  <TableCell className="text-right">{formatLastAsked(question.lastAskedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
