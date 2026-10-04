/**
 * Registers the lane job handlers the intelligence pipeline owns. Import this for its side effect from every entry
 * point that drains `channel_jobs` (the lane cron, the agent-jobs cron, the two webhook routes) — a job whose kind has
 * no registered handler is failed loudly by `processLane`, so an entry point that forgets this import cannot silently
 * consume ENRICH jobs, it dead-letters them.
 */

import "server-only";

import { enrichLaneJobHandler } from "@/lib/inbox/intelligence/pipeline";
import { registerLaneJobHandler } from "@/lib/inbox/jobs/drain";
import { mediaLaneJobHandler } from "@/lib/inbox/media/handlers";
import { replyLaneJobHandler } from "@/lib/inbox/reply/reply-job";

registerLaneJobHandler("ENRICH", enrichLaneJobHandler);
registerLaneJobHandler("REPLY", replyLaneJobHandler);
registerLaneJobHandler("TRANSCRIBE_VOICE", mediaLaneJobHandler);
registerLaneJobHandler("READ_DOCUMENT", mediaLaneJobHandler);
registerLaneJobHandler("EXTRACT_RECEIPT", mediaLaneJobHandler);
