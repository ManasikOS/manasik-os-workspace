/** Pure review scoring for a staff decision on a Copilot proposal. */
function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function proposalSimilarity(proposed: string, sent: string): number {
  const left = normalise(proposed);
  const right = normalise(sent);
  const longest = Math.max(left.length, right.length);
  return longest === 0 ? 1 : 1 - editDistance(left, right) / longest;
}

export function classifyProposalReview(proposed: string, sent: string, acceptanceThreshold = 0.7): { decision: "SENT" | "REJECTED"; correct: boolean; similarity: number } {
  const similarity = proposalSimilarity(proposed, sent);
  const correct = similarity >= acceptanceThreshold;
  return { decision: correct ? "SENT" : "REJECTED", correct, similarity };
}
