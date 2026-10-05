/**
 * Checks for the quota wording.
 *
 * There is no test runner in this project, and adding one for a single pure
 * module would be a heavier change than the module itself. This compiles with
 * the TypeScript already in devDependencies and runs on plain node:
 *
 *     npm run test:voice
 *
 * The rules worth pinning are about *which* fact wins. An open tab must beat an
 * exhausted budget, because closing the tab is the fix and the budget is not.
 */

import {
  describeCost,
  describeQuota,
  formatSessionLength,
  formatWait,
} from "../quotaMessage";
import type { Quota } from "../types";

let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}`);
    console.error(`      got  ${JSON.stringify(actual)}`);
    console.error(`      want ${JSON.stringify(expected)}`);
  } else {
    console.log(`pass  ${label}`);
  }
}

const healthy: Quota = {
  remaining_hour: 2,
  remaining_day: 3,
  per_day: 3,
  resets_in: 0,
  active_elsewhere: false,
  cooldown_remaining: 0,
  allowed: true,
};

// --- which fact leads -------------------------------------------------
check("nothing to say before the budget arrives", describeQuota(null, 0), null);

check(
  "an open tab outranks an exhausted hour, because it is fixable now",
  describeQuota({ ...healthy, active_elsewhere: true, remaining_hour: 0 }, 99)?.text,
  "You already have a conversation open in another tab.",
);

check(
  "a cooldown is reported as a short wait",
  describeQuota({ ...healthy, cooldown_remaining: 12 }, 0)?.text,
  "You can start again in 12s.",
);

check(
  "an exhausted hour names when it comes back",
  describeQuota({ ...healthy, remaining_hour: 0, resets_in: 600 }, 0)?.text,
  "You've used your sessions for this hour — more in 10m.",
);

check(
  "an exhausted day says so and offers nothing it cannot deliver",
  describeQuota({ ...healthy, remaining_hour: 0, remaining_day: 0 }, 0)?.text,
  "You've used your voice sessions for today.",
);

check("a healthy budget is not a blocker", describeQuota(healthy, 0), {
  text: "2 voice sessions left this hour",
  blocking: false,
});

check(
  "the day is named once it is the tighter of the two",
  describeQuota({ ...healthy, remaining_hour: 2, remaining_day: 1 }, 0)?.text,
  "1 voice session left today",
);

check(
  "one remaining reads as singular",
  describeQuota({ ...healthy, remaining_hour: 1 }, 0)?.text,
  "1 voice session left this hour",
);

// --- the warning shown before a call is spent -------------------------
check(
  "an untouched allowance is stated as the policy it is",
  describeCost(healthy, 300),
  "Voice calls are limited to 3 a day. This uses one, and runs up to 5 minutes.",
);

check(
  "a part-spent day quotes the balance instead",
  describeCost({ ...healthy, remaining_day: 2 }, 300),
  "You have 2 voice calls left today. This uses one, and runs up to 5 minutes.",
);

check(
  "the last one says so, because that is the fact that matters",
  describeCost({ ...healthy, remaining_day: 1 }, 300),
  "This is your last voice call for today, and it runs up to 5 minutes.",
);

check(
  "the hourly cap never leaks into the sentence",
  describeCost({ ...healthy, remaining_hour: 1, remaining_day: 3 }, 300),
  "Voice calls are limited to 3 a day. This uses one, and runs up to 5 minutes.",
);

check(
  "an unknown session length is simply left out",
  describeCost(healthy, null),
  "Voice calls are limited to 3 a day. This uses one.",
);

check(
  "nothing to warn about with nothing left to spend",
  describeCost({ ...healthy, remaining_hour: 0 }, 300),
  null,
);

check("no warning before the budget arrives", describeCost(null, 300), null);

check(
  "a server too old to report the allowance still states the cost",
  describeCost({ ...healthy, per_day: undefined as unknown as number }, 300),
  "You have 3 voice calls left today. This uses one, and runs up to 5 minutes.",
);

check(
  "the server's retry_after is honoured when it exceeds the quota's own",
  describeQuota({ ...healthy, cooldown_remaining: 2 }, 30)?.text,
  "You can start again in 30s.",
);

// --- durations --------------------------------------------------------
check("seconds stay seconds", formatWait(45), "45s");
check("a minute rounds up", formatWait(61), "2m");
check("hours for long waits", formatWait(7200), "2h");
check("zero reads as now", formatWait(0), "now");
check("session length in minutes", formatSessionLength(300), "5 minutes");
check("one minute is singular", formatSessionLength(60), "1 minute");
check("no length without a number", formatSessionLength(null), null);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll quota-message checks passed.");
