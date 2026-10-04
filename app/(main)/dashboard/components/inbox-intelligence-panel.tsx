"use client";

import type { InboxOwnerIntelligence } from "@/lib/data/dashboard-repository";
import { openInboxView } from "@/lib/inbox/open-inbox-event";
import { viewForQueue } from "@/lib/inbox/views";
import type { QueueCode } from "@/lib/inbox/intelligence/contracts";

function openOwnerMetricQueue(queueCode: string) {
  const view = viewForQueue(queueCode as QueueCode);
  if (view) openInboxView(view);
}

export function InboxIntelligencePanel({ data }: { data: InboxOwnerIntelligence }) {
  return (
    <section className="rounded-lg border bg-card p-5" aria-labelledby="inbox-intelligence-heading">
      <div className="mb-4">
        <h2 id="inbox-intelligence-heading" className="text-base font-semibold">Inbox intelligence</h2>
        <p className="text-sm text-muted-foreground">Every figure opens the conversations behind it. Counts come from deterministic queues, not a model.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.metrics.map((metric) => (
          <button key={metric.label} type="button" onClick={() => openOwnerMetricQueue(metric.queueCode)} className="rounded-md border p-3 text-left hover:border-primary/40">
            <span className="block text-xs text-muted-foreground">{metric.label}</span>
            <span className="mt-1 block text-xl font-semibold tabular-nums">{metric.value}</span>
          </button>
        ))}
        {data.pipeline.map((bucket) => (
          <button key={bucket.currency} type="button" onClick={() => openOwnerMetricQueue(bucket.queueCode)} className="rounded-md border p-3 text-left hover:border-primary/40">
            <span className="block text-xs text-muted-foreground">Pipeline influenced · estimate</span>
            <span className="mt-1 block text-xl font-semibold tabular-nums">{bucket.currency} {(bucket.amountCents / 100).toLocaleString("en-US")}</span>
          </button>
        ))}
        {data.languageBuckets.map((bucket) => (
          <div key={bucket.languageCode} className="rounded-md border p-3">
            <span className="block text-xs text-muted-foreground">Conversations in {bucket.languageCode}</span>
            <span className="mt-1 block text-xl font-semibold tabular-nums">{bucket.conversations}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
