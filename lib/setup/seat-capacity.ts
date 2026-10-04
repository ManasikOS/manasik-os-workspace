export interface SeatCapacity {
  /** Total seats, or null when the plan has no cap. */
  limit: number | null;
  used: number;
  remaining: number | null;
  atLimit: boolean;
}

/**
 * Seats an agency can still fill: the plan's allowance plus any purchased seats,
 * against active staff and open invitations. A plan with no allowance
 * (Enterprise, or an agency with no subscription row) is never blocked.
 */
export function computeSeatCapacity(input: {
  planAllowance: number | null | undefined;
  seatsPurchased: number;
  activeStaff: number;
  pendingInvitations: number;
}): SeatCapacity {
  const used = input.activeStaff + input.pendingInvitations;

  if (input.planAllowance === null || input.planAllowance === undefined) {
    return { limit: null, used, remaining: null, atLimit: false };
  }

  const limit = input.planAllowance + input.seatsPurchased;
  const remaining = Math.max(limit - used, 0);
  return { limit, used, remaining, atLimit: remaining === 0 };
}
