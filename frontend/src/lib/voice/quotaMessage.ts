/**
 * Turning a quota into a sentence.
 *
 * Kept apart from the component so the wording is a pure function of the
 * numbers — no React, no DOM — and so the rules that decide *which* fact to
 * lead with live in one readable place.
 *
 * The ordering rule: say the thing the visitor can act on. An open tab is
 * fixable right now, a cooldown is a short wait, an exhausted hour is a long
 * one. Leading with the wrong one reads as a brush-off.
 */

import type { Quota } from "./types";

/** "45s" / "3m" / "2h" — a duration a person reads at a glance. */
export function formatWait(seconds: number): string {
  if (seconds <= 0) return "now";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

/** "5 minutes" — how long one conversation lasts. */
export function formatSessionLength(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return `${seconds} seconds`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export interface QuotaNote {
  /** The headline fact. */
  text: string;
  /** True when the visitor cannot start right now. */
  blocking: boolean;
}

/**
 * What to tell the visitor about their allowance, or null when there is
 * nothing worth saying (a full budget needs no announcement beyond the
 * session length, which the caller shows separately).
 */
export function describeQuota(
  quota: Quota | null,
  retryAfter: number,
): QuotaNote | null {
  if (!quota) return null;

  if (quota.active_elsewhere) {
    return {
      text: "You already have a conversation open in another tab.",
      blocking: true,
    };
  }

  const cooldown = Math.max(quota.cooldown_remaining, retryAfter);
  if (cooldown > 0 && quota.remaining_hour > 0) {
    return { text: `You can start again in ${formatWait(cooldown)}.`, blocking: true };
  }

  if (quota.remaining_hour <= 0) {
    const wait = Math.max(quota.resets_in, retryAfter);
    return {
      text:
        quota.remaining_day <= 0
          ? "You've used your voice sessions for today."
          : `You've used your sessions for this hour — more in ${formatWait(wait)}.`,
      blocking: true,
    };
  }

  // Two budgets run at once and the smaller is the real answer. Saying "3 left
  // today" while the hour allows one more is a promise the next click breaks.
  const day = quota.remaining_day;
  const hour = quota.remaining_hour;
  const remaining = Math.min(hour, day);
  const period = day <= hour ? "today" : "this hour";

  return {
    text: `${remaining} voice session${remaining === 1 ? "" : "s"} left ${period}`,
    blocking: false,
  };
}

/**
 * The sentence shown before a call is dialled.
 *
 * A voice session is spent the moment it starts — a visitor who opens one to
 * see what happens and hangs up has burnt a third of their day. So the cost is
 * stated once, plainly, while cancelling is still free. Returns null when there
 * is nothing worth warning about: no known allowance, or nothing left to spend
 * (a refusal already explains that case).
 */
export function describeCost(
  quota: Quota | null,
  sessionSeconds: number | null,
): string | null {
  if (!quota) return null;

  // Nothing to warn about when nothing can be spent — a refusal is already
  // explaining that, and this would only argue with it.
  if (Math.min(quota.remaining_hour, quota.remaining_day) <= 0) return null;

  // A server too old to report the allowance still gets a warning, just the
  // balance-only one below. Stating the cost matters more than stating the rule.
  const perDay = Number.isFinite(quota.per_day) ? quota.per_day : 0;

  // The balance quoted is the day's, never the hour's. Both are true, but a
  // sentence carrying "3 a day" beside a smaller hourly number reads as a
  // contradiction — the visitor has no way to know the two windows differ.
  const left = quota.remaining_day;
  const length = formatSessionLength(sessionSeconds);
  const runs = length ? `, and runs up to ${length}` : "";

  // Its own suffix: the shared one trails "This uses one", where the subject is
  // already in the clause. Here it isn't, so the pronoun has to come back.
  if (left === 1) {
    const tail = length ? `, and it runs up to ${length}` : "";
    return `This is your last voice call for today${tail}.`;
  }

  if (perDay > 0 && left >= perDay) {
    return `Voice calls are limited to ${perDay} a day. This uses one${runs}.`;
  }

  return `You have ${left} voice calls left today. This uses one${runs}.`;
}
