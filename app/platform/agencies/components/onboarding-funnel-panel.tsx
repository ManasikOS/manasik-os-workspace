import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { detectSignupSpike } from "@/lib/onboarding/signup-spike";
import { loadOnboardingFunnel, loadSignupAttemptCounts } from "@/lib/setup/operator-setup-loader";
import { SETUP_CONNECTOR_COPY } from "@/lib/setup/connector-copy";
import { SETUP_STEPS } from "@/lib/setup/setup-steps";

const FUNNEL_DAYS = 30;

/**
 * Where new agencies stall in the guided setup, and whether signup is being
 * hammered. Counts are distinct agencies over the last 30 days; the "Viewed"
 * column is approximate (it counts a step once however often it is reopened).
 */
export async function OnboardingFunnelPanel() {
  const [funnel, attempts] = await Promise.all([loadOnboardingFunnel(FUNNEL_DAYS), loadSignupAttemptCounts()]);
  const spike = detectSignupSpike(attempts);
  const connectorRows = Object.entries(funnel.connectors).filter(([, counts]) => counts.started + counts.succeeded + counts.failed > 0);

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-foreground">Onboarding funnel, last {FUNNEL_DAYS} days</h2>
        <p className="text-xs text-muted-foreground">Number of agencies that reached each point.</p>
      </div>

      {spike.spike && (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          Signup requests are unusually high: {spike.lastHourAttempts} in the last hour, against about {Math.round(spike.baselinePerHour)} an hour
          before. Each request can send an email, so check for abuse.
        </p>
      )}
      {!spike.spike && (
        <p className="text-xs text-muted-foreground">
          {spike.lastHourAttempts} signup requests in the last hour. Nothing unusual.
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Step</TableHead>
            <TableHead>Viewed</TableHead>
            <TableHead>Completed</TableHead>
            <TableHead>Skipped</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SETUP_STEPS.map((step) => (
            <TableRow key={step.id}>
              <TableCell className="font-medium">{step.title}</TableCell>
              <TableCell>{funnel.steps[step.id].viewed}</TableCell>
              <TableCell>{funnel.steps[step.id].completed}</TableCell>
              <TableCell>{funnel.steps[step.id].skipped}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {connectorRows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Connector</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Connected</TableHead>
              <TableHead>Failed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connectorRows.map(([id, counts]) => (
              <TableRow key={id}>
                <TableCell className="font-medium">{SETUP_CONNECTOR_COPY[id as keyof typeof SETUP_CONNECTOR_COPY]?.title ?? id}</TableCell>
                <TableCell>{counts.started}</TableCell>
                <TableCell>{counts.succeeded}</TableCell>
                <TableCell>{counts.failed}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
