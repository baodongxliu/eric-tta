import { requireStudent } from "../auth.js";
import {
  listMembershipsForStudent,
  listLessonPurchasesForStudent,
  listLessonsUsedForStudent,
} from "../db.js";
import {
  computeHoursBalance,
  computeMembershipStatus,
  buildTimeline,
} from "../balance.js";
import { renderHeader, formatDate, escapeHtml, el } from "../ui.js";

(async () => {
  const { user, profile } = await requireStudent();
  renderHeader({ profile, active: "dashboard" });

  document.getElementById("greeting").textContent =
    `Welcome${profile?.displayName ? `, ${profile.displayName}` : ""}`;

  const currentFamilyGroupId = profile?.familyGroupId || null;
  const [memberships, purchases, used] = await Promise.all([
    listMembershipsForStudent(user.uid, currentFamilyGroupId),
    listLessonPurchasesForStudent(user.uid),
    listLessonsUsedForStudent(user.uid),
  ]);

  // Past family memberships (from a previous family the student no longer
  // belongs to) stay visible in the timeline below but must NOT count
  // toward current entitlement — entitlement requires the student to still
  // be in that family today.
  const currentMemberships = memberships.filter(
    (m) => m.ownerType === "student" || m.ownerId === currentFamilyGroupId
  );

  // ─── Membership card + banner ─────────────────────────────
  const ms = computeMembershipStatus(currentMemberships);
  const tierEl = document.getElementById("ms-tier");
  const subEl = document.getElementById("ms-sub");
  const banner = document.getElementById("membership-banner");

  if (ms.status === "active") {
    tierEl.textContent = ms.tier || "Active";
    subEl.textContent = `${ms.daysRemaining} day${ms.daysRemaining === 1 ? "" : "s"} left · expires ${formatDate(ms.validUntil)}`;
    if (ms.daysRemaining <= 14) {
      banner.innerHTML = `<div class="banner banner-warn">Your membership expires in ${ms.daysRemaining} day${ms.daysRemaining === 1 ? "" : "s"}. Talk to Eric about renewing.</div>`;
    }
  } else if (ms.status === "expired") {
    tierEl.textContent = "Expired";
    subEl.textContent = `Last tier: ${ms.tier || "—"} · expired ${formatDate(ms.validUntil)}`;
    banner.innerHTML = `<div class="banner banner-bad">Your membership has expired. See Eric to renew.</div>`;
  } else {
    tierEl.textContent = "None";
    subEl.textContent = "No membership on file yet.";
  }

  // ─── Hour cards ───────────────────────────────────────────
  const priv = computeHoursBalance(purchases, used, "private");
  const grp = computeHoursBalance(purchases, used, "group");
  document.getElementById("priv-remaining").textContent = formatHours(priv.remaining);
  document.getElementById("priv-sub").textContent =
    `Purchased ${formatHours(priv.purchased)} · Used ${formatHours(priv.used)}`;
  document.getElementById("grp-remaining").textContent = formatHours(grp.remaining);
  document.getElementById("grp-sub").textContent =
    `Purchased ${formatHours(grp.purchased)} · Used ${formatHours(grp.used)}`;

  // ─── Recent activity ──────────────────────────────────────
  const recentEl = document.getElementById("recent");
  const timeline = buildTimeline({ memberships, purchases, used }).slice(0, 5);
  if (timeline.length === 0) {
    recentEl.innerHTML = `<p class="table-empty">No activity yet.</p>`;
  } else {
    const table = el("table", { class: "table" },
      el("thead", {}, el("tr", {},
        el("th", {}, "Date"),
        el("th", {}, "Type"),
        el("th", {}, "Detail"),
        el("th", {}, "Notes"),
      )),
    );
    const tbody = el("tbody");
    for (const item of timeline) tbody.appendChild(rowFor(item));
    table.appendChild(tbody);
    recentEl.innerHTML = "";
    recentEl.appendChild(table);
  }
})();

function formatHours(n) {
  if (n == null || isNaN(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function rowFor(item) {
  if (item.kind === "membership") {
    return el("tr", {},
      el("td", {}, formatDate(item.date)),
      el("td", { html: `<span class="chip chip-membership">Membership</span>` }),
      el("td", {}, `${item.tier} · valid through ${formatDate(item.validUntil)}`),
      el("td", {}, item.notes || ""),
    );
  }
  if (item.kind === "purchase") {
    const chip = item.type === "private" ? "chip-private" : "chip-group";
    return el("tr", {},
      el("td", {}, formatDate(item.date)),
      el("td", { html: `<span class="chip ${chip}">${escapeHtml(item.type)} purchase</span>` }),
      el("td", {}, `+${formatHours(item.hours)} h`),
      el("td", {}, item.notes || ""),
    );
  }
  // used
  const chip = item.type === "private" ? "chip-private" : "chip-group";
  return el("tr", {},
    el("td", {}, formatDate(item.date)),
    el("td", { html: `<span class="chip ${chip}">${escapeHtml(item.type)} lesson</span>` }),
    el("td", {}, `−${formatHours(item.hours)} h${item.coachName ? ` · Coach ${item.coachName}` : ""}`),
    el("td", {}, item.notes || ""),
  );
}
