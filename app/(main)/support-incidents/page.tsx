import { permanentRedirect } from "next/navigation";

import { legacyOperationsRedirectHref } from "@/app/(main)/operations/operations-workspace-navigation";

/**
 * Retired top-level page. Its workflow now lives in Operations; this keeps old
 * bookmarks working. Agency and role enforcement happen on the Operations page.
 */
export default function RetiredOperateListRedirect(): never {
  permanentRedirect(legacyOperationsRedirectHref("/support-incidents") ?? "/operations");
}
