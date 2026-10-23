import { redirect } from "next/navigation";

/**
 * Group creation is the full-page editor at `/departure-groups/new`. This
 * route stays only so existing links and bookmarks land somewhere sensible.
 */
export default function CreateDepartureGroupPage() {
  redirect("/departure-groups/new");
}
