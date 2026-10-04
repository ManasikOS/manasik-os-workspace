import SectionHeading from "@/components/section-heading";

import { NewAgencyForm } from "./new-agency-form";

export default function NewAgencyPage() {
  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <SectionHeading title="New agency" description="Provisions the tenant and invites its first ADMIN." />
      <NewAgencyForm />
    </div>
  );
}
