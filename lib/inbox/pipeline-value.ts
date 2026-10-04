export interface PipelineOfferValue { currency: string; amountCents: number }
export interface PipelineValueBucket { currency: string; amountCents: number; label: string; queueCode: "QUALIFIED" }

export function bucketPipelineValue(values: readonly PipelineOfferValue[], defaultCurrency: string): PipelineValueBucket[] {
  const totals = new Map<string, number>();
  for (const value of values) totals.set(value.currency, (totals.get(value.currency) ?? 0) + value.amountCents);
  return [...totals.entries()]
    .sort(([currencyA, amountA], [currencyB, amountB]) => currencyA === defaultCurrency ? -1 : currencyB === defaultCurrency ? 1 : amountB - amountA)
    .map(([currency, amountCents]) => ({ currency, amountCents, label: `${currency} estimate`, queueCode: "QUALIFIED" as const }));
}
