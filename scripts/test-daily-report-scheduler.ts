import assert from "node:assert/strict";
import {
  computeNextShanghaiTriggerMs,
  getShanghaiDateAndClock,
  getShanghaiSlotIso,
  isAtOrAfterShanghaiSlot,
} from "../lib/daily-report-scheduler";

function run() {
  // 1. 00:01 CST -> before 18:00, triggers today at 18:00:00+08:00
  const tMidnight = new Date("2026-11-25T00:01:00+08:00");
  assert.equal(isAtOrAfterShanghaiSlot(tMidnight, 18, 0), false);
  const msFromMidnight = computeNextShanghaiTriggerMs(tMidnight, 18, 0);
  assert.equal(msFromMidnight, 17 * 3600 * 1000 + 59 * 60 * 1000);

  // 2. 17:59:59 CST -> before 18:00, triggers in 1000ms
  const tJustBefore = new Date("2026-11-25T17:59:59+08:00");
  assert.equal(isAtOrAfterShanghaiSlot(tJustBefore, 18, 0), false);
  assert.equal(computeNextShanghaiTriggerMs(tJustBefore, 18, 0), 1000);

  // 3. Exact 18:00:00 CST -> at/after slot, next trigger is tomorrow 18:00:00 (24h)
  const tExact = new Date("2026-11-25T18:00:00+08:00");
  assert.equal(isAtOrAfterShanghaiSlot(tExact, 18, 0), true);
  assert.equal(computeNextShanghaiTriggerMs(tExact, 18, 0), 24 * 3600 * 1000);

  // 4. 18:00:01 CST -> at/after slot, next trigger is tomorrow 18:00:00
  const tJustAfter = new Date("2026-11-25T18:00:01+08:00");
  assert.equal(isAtOrAfterShanghaiSlot(tJustAfter, 18, 0), true);
  assert.equal(computeNextShanghaiTriggerMs(tJustAfter, 18, 0), 24 * 3600 * 1000 - 1000);

  // 5. Year/month rollover: 2026-12-31T23:30:00+08:00 -> 2027-01-01T18:00:00+08:00 (18h30m)
  const tNewYearEve = new Date("2026-12-31T23:30:00+08:00");
  assert.equal(isAtOrAfterShanghaiSlot(tNewYearEve, 18, 0), true);
  const msNewYear = computeNextShanghaiTriggerMs(tNewYearEve, 18, 0);
  assert.equal(msNewYear, 18 * 3600 * 1000 + 30 * 60 * 1000);
  const nextTriggerIso = new Date(tNewYearEve.getTime() + msNewYear);
  assert.equal(getShanghaiDateAndClock(nextTriggerIso).dateStr, "2027-01-01");
  assert.equal(getShanghaiDateAndClock(nextTriggerIso).hour, 18);
  assert.equal(getShanghaiSlotIso("2026-11-25", 18, 0), "2026-11-25T18:00:00+08:00");

  console.log("test-daily-report-scheduler: all assertions passed");
}

run();
