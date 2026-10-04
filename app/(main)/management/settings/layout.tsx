import Link from "next/link";
import { redirect } from "next/navigation";

import PageHeader from "@/components/page-header";
import {
  capabilitiesForSettings,
  visibleSettingsSections,
} from "@/lib/access/settings-access";
import { capabilitiesForSetup } from "@/lib/access/setup-access";
import { Button } from "@/components/ui/button";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";

import { SettingsNav } from "./components/settings-nav";
import { Card } from "@/components/ui/card";

/**
 * Settings is Admin's screen. Every other role sees at most one section
 * (Finance Defaults for Finance, Operational Defaults for Operations,
 * Communication Templates for Marketing/Visa) or none — Guide is redirected
 * to their own Team profile, the same personal-preferences surface Team
 * already sends non-directory roles to. See the Settings plan §6.
 */
export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role, staffId } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewModule) {
    redirect(staffId ? `/management/team/${staffId}` : "/management/team");
  }

  const sections = visibleSettingsSections(role);

  return (
    <div className="flex flex-col gap-6 w-full mx-auto pb-10">
      <PageHeader
        title="Settings"
        subTitle="Configure your agency, operational rules, integrations, and security."
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Management", link: "/management/team" },
          { title: "Settings", link: "/management/settings" },
        ]}
        action={
          capabilitiesForSetup(role).viewSetup ? (
            <Button variant="outline" render={<Link href="/setup" />}>
              Setup guide
            </Button>
          ) : null
        }
      />
      <Card className="flex flex-col p-4 md:flex-row gap-6 w-full items-start">
        <SettingsNav sections={sections} />
        <div className="flex-1 min-w-0 w-full border-l pl-5">{children}</div>
      </Card>
    </div>
  );
}
