/**
 * The `next=` value the proxy attaches when it sends a signed-out visitor to
 * a login page. It keeps the query string so a shared deep link such as
 * `/operations?tab=support` returns to the same queue after login. The value
 * is always a same-origin path; `safeRedirectPath()` re-checks it on use.
 */
export function loginReturnPath(pathname: string, search: string): string | null {
  return pathname === "/" ? null : `${pathname}${search}`;
}
