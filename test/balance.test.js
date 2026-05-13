// Run with: node --test test/balance.test.js
//
// `balance.js` was designed to be pure — no Firebase imports, no DOM —
// specifically so it could be unit-tested without an emulator. These
// tests cover the off-by-one edge cases on daysRemaining, the active /
// expired / none status branches, hour summation, and the timeline
// filter boundaries.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeMembershipStatus,
  computeHoursBalance,
  buildTimeline,
  filterByDateRange,
} from "../js/balance.js";

const day = (s) => new Date(`${s}T00:00:00`);

test("computeMembershipStatus: no memberships → none", () => {
  assert.deepEqual(computeMembershipStatus([]), { status: "none" });
});

test("computeMembershipStatus: today === validUntil → 1 day left, active", () => {
  const ms = computeMembershipStatus(
    [{ tier: "Adult", validFrom: day("2026-01-01"), validUntil: day("2026-05-04") }],
    day("2026-05-04")
  );
  assert.equal(ms.status, "active");
  assert.equal(ms.tier, "Adult");
  assert.equal(ms.daysRemaining, 1);
});

test("computeMembershipStatus: tomorrow validUntil → 2 days left", () => {
  const ms = computeMembershipStatus(
    [{ tier: "Adult", validFrom: day("2026-01-01"), validUntil: day("2026-05-05") }],
    day("2026-05-04")
  );
  assert.equal(ms.daysRemaining, 2);
});

test("computeMembershipStatus: validUntil yesterday → expired", () => {
  const ms = computeMembershipStatus(
    [{ tier: "Adult", validFrom: day("2026-01-01"), validUntil: day("2026-05-03") }],
    day("2026-05-04")
  );
  assert.equal(ms.status, "expired");
  assert.equal(ms.daysRemaining, 0);
});

test("computeMembershipStatus: picks longest-running active membership", () => {
  const ms = computeMembershipStatus(
    [
      { tier: "Adult", validFrom: day("2026-01-01"), validUntil: day("2026-06-01") },
      { tier: "Junior", validFrom: day("2026-04-01"), validUntil: day("2026-12-31") },
    ],
    day("2026-05-04")
  );
  assert.equal(ms.tier, "Junior");
  assert.equal(ms.status, "active");
});

test("computeMembershipStatus: validFrom in the future → not yet active", () => {
  const ms = computeMembershipStatus(
    [
      { tier: "Future", validFrom: day("2026-06-01"), validUntil: day("2027-06-01") },
      { tier: "Past", validFrom: day("2025-01-01"), validUntil: day("2026-01-01") },
    ],
    day("2026-05-04")
  );
  // No active → falls back to most-recently-expired.
  assert.equal(ms.status, "expired");
  assert.equal(ms.tier, "Past");
});

test("computeHoursBalance: sums by type and computes remaining", () => {
  const purchases = [
    { type: "private", hours: 10 },
    { type: "private", hours: 5 },
    { type: "group", hours: 8 },
  ];
  const used = [
    { type: "private", hours: 4 },
    { type: "group", hours: 2 },
  ];
  assert.deepEqual(computeHoursBalance(purchases, used, "private"), {
    purchased: 15,
    used: 4,
    remaining: 11,
  });
  assert.deepEqual(computeHoursBalance(purchases, used, "group"), {
    purchased: 8,
    used: 2,
    remaining: 6,
  });
});

test("computeHoursBalance: handles empty inputs", () => {
  assert.deepEqual(computeHoursBalance([], [], "private"), {
    purchased: 0,
    used: 0,
    remaining: 0,
  });
});

test("computeHoursBalance: tolerates missing/non-numeric hours", () => {
  const out = computeHoursBalance(
    [{ type: "private", hours: "3.5" }, { type: "private" }, { type: "private", hours: 1 }],
    [{ type: "private", hours: "1" }],
    "private"
  );
  assert.equal(out.purchased, 4.5);
  assert.equal(out.used, 1);
  assert.equal(out.remaining, 3.5);
});

test("buildTimeline: merges and sorts descending", () => {
  const items = buildTimeline({
    memberships: [
      {
        id: "m1",
        tier: "Adult",
        purchaseDate: day("2026-04-01"),
        validFrom: day("2026-04-01"),
        validUntil: day("2027-04-01"),
        notes: "",
      },
    ],
    purchases: [
      { id: "p1", type: "private", hours: 10, purchaseDate: day("2026-04-15") },
    ],
    used: [
      { id: "u1", type: "private", hours: 1, date: day("2026-05-01") },
      { id: "u2", type: "group", hours: 1, date: day("2026-04-10") },
    ],
  });
  assert.equal(items.length, 4);
  assert.equal(items[0]._id, "u1");
  assert.equal(items[1]._id, "p1");
  assert.equal(items[2]._id, "u2");
  assert.equal(items[3]._id, "m1");
});

test("filterByDateRange: same from/to includes the whole day", () => {
  const items = [
    { date: day("2026-05-04") },
    { date: new Date("2026-05-04T15:30:00") },
    { date: day("2026-05-05") },
    { date: day("2026-05-03") },
  ];
  const out = filterByDateRange(items, day("2026-05-04"), day("2026-05-04"));
  assert.equal(out.length, 2);
});

test("filterByDateRange: open ranges work", () => {
  const items = [
    { date: day("2026-04-01") },
    { date: day("2026-05-01") },
    { date: day("2026-06-01") },
  ];
  assert.equal(filterByDateRange(items, null, day("2026-05-15")).length, 2);
  assert.equal(filterByDateRange(items, day("2026-04-15"), null).length, 2);
  assert.equal(filterByDateRange(items, null, null).length, 3);
});
