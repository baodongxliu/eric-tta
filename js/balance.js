// Pure compute functions over already-fetched arrays. No Firebase imports
// here so these are easy to reason about and would unit-test trivially.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate(); // Firestore Timestamp
  return new Date(value);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function computeHoursBalance(purchases, used, type) {
  const purchased = purchases
    .filter((p) => p.type === type)
    .reduce((acc, p) => acc + Number(p.hours || 0), 0);
  const consumed = used
    .filter((u) => u.type === type)
    .reduce((acc, u) => acc + Number(u.hours || 0), 0);
  return {
    purchased,
    used: consumed,
    remaining: purchased - consumed,
  };
}

// Returns { status: "active"|"expired"|"none", tier?, validFrom?, validUntil?, daysRemaining? }
export function computeMembershipStatus(memberships, today = new Date()) {
  if (!memberships || memberships.length === 0) {
    return { status: "none" };
  }
  const todayStart = startOfDay(today);
  const enriched = memberships.map((m) => ({
    ...m,
    _from: toDate(m.validFrom),
    _until: toDate(m.validUntil),
  }));

  // Active: validFrom <= today <= validUntil. Pick the one expiring latest.
  const active = enriched
    .filter((m) => m._from && m._until && m._from <= todayStart && m._until >= todayStart)
    .sort((a, b) => b._until - a._until);
  if (active.length > 0) {
    const m = active[0];
    return {
      status: "active",
      tier: m.tier,
      validFrom: m._from,
      validUntil: m._until,
      // Inclusive of validUntil itself: today=validUntil → 1 day left.
      daysRemaining: Math.floor((m._until - todayStart) / MS_PER_DAY) + 1,
    };
  }

  // Otherwise return the most recently expired one for context.
  const past = enriched
    .filter((m) => m._until)
    .sort((a, b) => b._until - a._until);
  if (past.length > 0) {
    const m = past[0];
    return {
      status: "expired",
      tier: m.tier,
      validFrom: m._from,
      validUntil: m._until,
      daysRemaining: 0,
    };
  }
  return { status: "none" };
}

// Build a unified, date-sorted timeline from the three record types.
export function buildTimeline({ memberships = [], purchases = [], used = [] }) {
  const items = [];
  for (const m of memberships) {
    items.push({
      kind: "membership",
      date: toDate(m.purchaseDate) || toDate(m.validFrom),
      tier: m.tier,
      validFrom: toDate(m.validFrom),
      validUntil: toDate(m.validUntil),
      notes: m.notes || "",
      _id: m.id,
    });
  }
  for (const p of purchases) {
    items.push({
      kind: "purchase",
      date: toDate(p.purchaseDate),
      type: p.type,
      hours: p.hours,
      notes: p.notes || "",
      _id: p.id,
    });
  }
  for (const u of used) {
    items.push({
      kind: "used",
      date: toDate(u.date),
      type: u.type,
      hours: u.hours,
      coachName: u.coachName || "",
      notes: u.notes || "",
      _id: u.id,
    });
  }
  return items
    .filter((x) => x.date)
    .sort((a, b) => b.date - a.date);
}

// Filter timeline by inclusive date range (Date objects). Either bound may be null.
export function filterByDateRange(items, from, to) {
  const fromTs = from ? startOfDay(from).getTime() : -Infinity;
  const toTs = to ? startOfDay(to).getTime() + MS_PER_DAY - 1 : Infinity;
  return items.filter((x) => {
    const t = x.date.getTime();
    return t >= fromTs && t <= toTs;
  });
}
