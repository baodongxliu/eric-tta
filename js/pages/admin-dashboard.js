import { requireAdmin } from "../auth.js";
import {
  watchAllStudents,
  watchFamilyGroups,
  watchAllMemberships,
  watchAllLessonPurchases,
  watchAllLessonsUsed,
  deleteMembershipRecord,
  deleteLessonPurchaseRecord,
  deleteLessonUsedRecord,
} from "../db.js";
import {
  computeMembershipStatus,
  computeHoursBalance,
  buildTimeline,
} from "../balance.js";
import { renderHeader, formatDate, escapeHtml, el } from "../ui.js";

// Live state. Each key starts null until its first snapshot arrives;
// we delay rendering until everything has loaded once.
const state = {
  students: null,
  groups: null,
  memberships: null,
  purchases: null,
  used: null,
};

(async () => {
  const { profile } = await requireAdmin();
  renderHeader({ profile, active: "dashboard" });

  // Subscribe to each collection; every change triggers maybeRender().
  watchAllStudents((arr) => {
    state.students = arr;
    maybeRender();
  });
  watchFamilyGroups((arr) => {
    state.groups = arr;
    maybeRender();
  });
  watchAllMemberships((arr) => {
    state.memberships = arr;
    maybeRender();
  });
  watchAllLessonPurchases((arr) => {
    state.purchases = arr;
    maybeRender();
  });
  watchAllLessonsUsed((arr) => {
    state.used = arr;
    maybeRender();
  });

  // Reflect online/offline status on the live pill.
  const live = document.getElementById("live-pill");
  const liveLabel = document.getElementById("live-label");
  const updatePill = () => {
    if (!live) return;
    live.classList.toggle("is-stale", !navigator.onLine);
    if (liveLabel) liveLabel.textContent = navigator.onLine ? "Live" : "Offline";
  };
  updatePill();
  window.addEventListener("online", updatePill);
  window.addEventListener("offline", updatePill);
})();

function maybeRender() {
  if (
    state.students == null ||
    state.groups == null ||
    state.memberships == null ||
    state.purchases == null ||
    state.used == null
  ) {
    return;
  }
  render();
}

function render() {
  const { students, groups, memberships, purchases, used } = state;

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const studentById = new Map(students.map((s) => [s.uid, s]));

  // Per-student summary (membership status + hours).
  const today = new Date();
  const summaries = students.map((s) => {
    const ownMs = memberships.filter(
      (m) => m.ownerType === "student" && m.ownerId === s.uid
    );
    const famMs = s.familyGroupId
      ? memberships.filter(
          (m) => m.ownerType === "family" && m.ownerId === s.familyGroupId
        )
      : [];
    const ms = computeMembershipStatus([...ownMs, ...famMs], today);
    const sp = purchases.filter((p) => p.studentId === s.uid);
    const su = used.filter((u) => u.studentId === s.uid);
    const priv = computeHoursBalance(sp, su, "private");
    const grp = computeHoursBalance(sp, su, "group");
    return { student: s, ms, priv, grp };
  });

  // ─── KPI tiles ────────────────────────────────────────────────────
  document.getElementById("kpi-students").textContent = students.length;

  const activeCount = summaries.filter((x) => x.ms.status === "active").length;
  const noneCount = summaries.filter((x) => x.ms.status !== "active").length;
  document.getElementById("kpi-active").textContent = activeCount;
  document.getElementById("kpi-active-sub").textContent = `${noneCount} without active membership`;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const todays = used.filter((u) => {
    const d = u.date?.toDate ? u.date.toDate() : new Date(u.date);
    return d >= todayStart && d < todayEnd;
  });
  document.getElementById("kpi-today").textContent = todays.length;
  const totalHoursToday = todays.reduce((acc, u) => acc + Number(u.hours || 0), 0);
  document.getElementById("kpi-today-sub").textContent = `${formatHours(totalHoursToday)} hours total`;

  const expiring = summaries.filter(
    (x) => x.ms.status === "active" && x.ms.daysRemaining <= 14
  );
  const low = summaries.filter(
    (x) => x.priv.remaining < 2 || x.grp.remaining < 2
  );
  // Distinct count: a student in both lists shouldn't be counted twice.
  const attentionUids = new Set([
    ...expiring.map((x) => x.student.uid),
    ...low.map((x) => x.student.uid),
  ]);
  document.getElementById("kpi-attention").textContent = attentionUids.size;

  // ─── Expiring within 14 days ──────────────────────────────────────
  const expEl = document.getElementById("expiring");
  if (expiring.length === 0) {
    expEl.innerHTML = `<p class="table-empty">No memberships expiring soon.</p>`;
  } else {
    const t = el("table", { class: "table" },
      el("thead", {}, el("tr", {},
        el("th", {}, "Student"),
        el("th", {}, "Tier"),
        el("th", {}, "Expires"),
        el("th", {}, "Days left"),
      )),
    );
    const tb = el("tbody");
    for (const x of expiring.sort((a, b) => a.ms.daysRemaining - b.ms.daysRemaining)) {
      tb.appendChild(el("tr", {},
        el("td", {}, x.student.displayName || x.student.email),
        el("td", {}, x.ms.tier || ""),
        el("td", {}, formatDate(x.ms.validUntil)),
        el("td", { html: `<span class="chip ${x.ms.daysRemaining <= 7 ? "chip-bad" : "chip-warn"}">${x.ms.daysRemaining}</span>` }),
      ));
    }
    t.appendChild(tb);
    expEl.innerHTML = "";
    expEl.appendChild(t);
  }

  // ─── Low balances ─────────────────────────────────────────────────
  const lowEl = document.getElementById("low-balances");
  if (low.length === 0) {
    lowEl.innerHTML = `<p class="table-empty">All students have ≥2 hours of each type.</p>`;
  } else {
    const t = el("table", { class: "table" },
      el("thead", {}, el("tr", {},
        el("th", {}, "Student"),
        el("th", {}, "Private remaining"),
        el("th", {}, "Group remaining"),
      )),
    );
    const tb = el("tbody");
    for (const x of low) {
      tb.appendChild(el("tr", {},
        el("td", {}, x.student.displayName || x.student.email),
        el("td", { html: cellForHours(x.priv.remaining) }),
        el("td", { html: cellForHours(x.grp.remaining) }),
      ));
    }
    t.appendChild(tb);
    lowEl.innerHTML = "";
    lowEl.appendChild(t);
  }

  // ─── Today's lessons ──────────────────────────────────────────────
  const todayEl = document.getElementById("today-lessons");
  if (todays.length === 0) {
    todayEl.innerHTML = `<p class="table-empty">No lessons logged today yet.</p>`;
  } else {
    const t = el("table", { class: "table" },
      el("thead", {}, el("tr", {},
        el("th", {}, "Student"),
        el("th", {}, "Type"),
        el("th", {}, "Hours"),
        el("th", {}, "Coach"),
        el("th", {}, "Notes"),
      )),
    );
    const tb = el("tbody");
    for (const u of todays.sort(
      (a, b) =>
        (b.date?.toDate?.() || new Date(b.date)) -
        (a.date?.toDate?.() || new Date(a.date))
    )) {
      const s = studentById.get(u.studentId);
      const chip = u.type === "private" ? "chip-private" : "chip-group";
      tb.appendChild(el("tr", {},
        el("td", {}, s?.displayName || s?.email || u.studentId),
        el("td", { html: `<span class="chip ${chip}">${escapeHtml(u.type)}</span>` }),
        el("td", {}, formatHours(u.hours)),
        el("td", {}, u.coachName || ""),
        el("td", {}, u.notes || ""),
      ));
    }
    t.appendChild(tb);
    todayEl.innerHTML = "";
    todayEl.appendChild(t);
  }

  // ─── Recent activity (top 20 across everything) ───────────────────
  const recentEl = document.getElementById("recent");
  const labelOf = (m) => {
    if (m.ownerType === "family") return groupById.get(m.ownerId)?.name || "Family";
    return studentById.get(m.ownerId || m.studentId)?.displayName || "—";
  };
  const labelStudent = (id) =>
    studentById.get(id)?.displayName || studentById.get(id)?.email || id;

  const tl = buildTimeline({ memberships, purchases, used }).slice(0, 20);
  if (tl.length === 0) {
    recentEl.innerHTML = `<p class="table-empty">No activity yet.</p>`;
  } else {
    const t = el("table", { class: "table" },
      el("thead", {}, el("tr", {},
        el("th", {}, "Date"),
        el("th", {}, "Who"),
        el("th", {}, "Type"),
        el("th", {}, "Detail"),
        el("th", {}, ""),
      )),
    );
    const tb = el("tbody");
    for (const item of tl) {
      let who = "";
      let type = "";
      let detail = "";
      let summary = "";
      if (item.kind === "membership") {
        const m = memberships.find((x) => x.id === item._id);
        who = labelOf(m);
        type = `<span class="chip chip-membership">Membership</span>`;
        detail = `${item.tier} · ${formatDate(item.validFrom)} → ${formatDate(item.validUntil)}`;
        summary = `${item.tier} membership for ${who}`;
      } else if (item.kind === "purchase") {
        const p = purchases.find((x) => x.id === item._id);
        who = labelStudent(p.studentId);
        const chip = item.type === "private" ? "chip-private" : "chip-group";
        type = `<span class="chip ${chip}">${escapeHtml(item.type)} purchase</span>`;
        detail = `+${formatHours(item.hours)} h${item.notes ? " · " + escapeHtml(item.notes) : ""}`;
        summary = `${item.type} +${formatHours(item.hours)}h purchase for ${who}`;
      } else {
        const u = used.find((x) => x.id === item._id);
        who = labelStudent(u.studentId);
        const chip = item.type === "private" ? "chip-private" : "chip-group";
        type = `<span class="chip ${chip}">${escapeHtml(item.type)} lesson</span>`;
        detail = `−${formatHours(item.hours)} h${item.coachName ? " · Coach " + escapeHtml(item.coachName) : ""}`;
        summary = `${item.type} ${formatHours(item.hours)}h lesson for ${who}`;
      }
      const delBtn = el("button", {
        type: "button",
        class: "btn btn-ghost",
        title: "Delete this record",
        onClick: () => onDeleteRecord(item.kind, item._id, summary),
      }, "Delete");
      tb.appendChild(el("tr", {},
        el("td", {}, formatDate(item.date)),
        el("td", {}, who),
        el("td", { html: type }),
        el("td", { html: detail }),
        el("td", {}, delBtn),
      ));
    }
    t.appendChild(tb);
    recentEl.innerHTML = "";
    recentEl.appendChild(t);
  }
}

async function onDeleteRecord(kind, id, summary) {
  if (!confirm(`Delete: ${summary}?\n\nThis cannot be undone. Re-log the record manually if you need a corrected version.`)) {
    return;
  }
  try {
    if (kind === "membership") await deleteMembershipRecord(id);
    else if (kind === "purchase") await deleteLessonPurchaseRecord(id);
    else if (kind === "used") await deleteLessonUsedRecord(id);
    // Realtime listeners will refresh the dashboard automatically.
  } catch (e) {
    alert(`Could not delete: ${e.message || e}`);
  }
}

function cellForHours(n) {
  if (n < 0) return `<span class="chip chip-bad">${formatHours(n)}</span>`;
  if (n < 2) return `<span class="chip chip-warn">${formatHours(n)}</span>`;
  return `<span class="chip chip-good">${formatHours(n)}</span>`;
}

function formatHours(n) {
  if (n == null || isNaN(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
