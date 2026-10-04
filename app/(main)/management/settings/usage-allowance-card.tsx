export function UsageAllowanceCard({ planName, used, allowance, overageOptIn }: { planName: string; used: number; allowance: number | null; overageOptIn: boolean }) {
  const percent = allowance ? Math.round((used / allowance) * 100) : 0;
  return <section className="rounded-lg border p-4"><h2 className="text-sm font-semibold">Plan and AI allowance</h2><p className="mt-1 text-xs text-muted-foreground">{planName} · {overageOptIn ? "Overage enabled" : "Overage disabled"}</p><p className="mt-3 text-2xl font-semibold tabular-nums">{used.toLocaleString()} / {allowance?.toLocaleString() ?? "Unlimited"}</p><p className="text-xs text-muted-foreground">AI-assisted conversations this billing period{allowance ? ` · ${percent}% used` : ""}</p></section>;
}
