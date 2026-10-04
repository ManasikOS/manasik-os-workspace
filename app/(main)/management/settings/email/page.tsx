import { notFound } from "next/navigation";
import { getEmailSectionData } from "./actions";
import { EmailSettings } from "./email-settings";

export default async function EmailSettingsPage() {
  const data = await getEmailSectionData();
  if (!data.ok) notFound();
  return <EmailSettings initial={data} />;
}
