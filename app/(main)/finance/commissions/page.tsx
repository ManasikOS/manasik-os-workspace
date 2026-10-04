import { redirect } from "next/navigation";

/**
 * Commission rules/accruals now live under the Agent Portal, where
 * sales_agents actually exists to attach them to — see
 * supabase/migrations/20261021090000_agent_portal.sql.
 */
export default function CommissionsPage() {
  redirect("/relationships/agent-portal?tab=commissions");
}
