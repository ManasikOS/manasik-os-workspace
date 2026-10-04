import { redirect } from "next/navigation";

/**
 * Group creation is a focused two-step Sheet on the list page, not a full-page
 * wizard — the seven-step wizard belongs to Package Templates, where the volume
 * of configuration justifies it. This route stays only so existing links and
 * bookmarks land somewhere sensible.
 */
export default function CreateDepartureGroupPage() {
  redirect("/departure-groups");
}
