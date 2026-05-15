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
  updateMembershipRecord,
  updateLessonPurchaseRecord,
  updateLessonUsedRecord,
} from "../db.js";
import {
  computeMembershipStatus,
  computeHoursBalance,
  buildTimeline,
} from "../balance.js";
import {
  renderHeader,
  formatDate,
  formatDateInput,
  parseDateInput,
  escapeHtml,
  el,
  confirmAction,
  showToast,
} from "../ui.js";

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
        el("th", {}, ""),
      )),
    );
    const tb = el("tbody");
    for (const u of todays.sort(
      (a, b) =>
        (b.date?.toDate?.() || new Date(b.date)) -
        (a.date?.toDate?.() || new Date(a.date))
    )) {
      const s = studentById.get(u.studentId);
      const studentLabel = s?.displayName || s?.email || u.studentId;
      const chip = u.type === "private" ? "chip-private" : "chip-group";
      const editBtn = el("button", {
        type: "button",
        class: "btn btn-ghost",
        title: "Edit this lesson",
        onClick: () => onEditRecord("used", u.id),
      }, "Edit");
      const delBtn = el("button", {
        type: "button",
        class: "btn btn-ghost",
        title: "Delete this lesson",
        onClick: () =>
          onDeleteRecord(
            "used",
            u.id,
            `${u.type} ${formatHours(u.hours)}h lesson for ${studentLabel}`
          ),
      }, "Delete");
      tb.appendChild(el("tr", {},
        el("td", {}, studentLabel),
        el("td", { html: `<span class="chip ${chip}">${escapeHtml(u.type)}</span>` }),
        el("td", {}, formatHours(u.hours)),
        el("td", {}, u.coachName || ""),
        el("td", {}, u.notes || ""),
        el("td", { class: "row-actions" }, editBtn, delBtn),
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
      const editBtn = el("button", {
        type: "button",
        class: "btn btn-ghost",
        title: "Edit this record",
        onClick: () => onEditRecord(item.kind, item._id),
      }, "Edit");
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
        el("td", { class: "row-actions" }, editBtn, delBtn),
      ));
    }
    t.appendChild(tb);
    recentEl.innerHTML = "";
    recentEl.appendChild(t);
  }
}

async function onDeleteRecord(kind, id, summary) {
  const ok = await confirmAction({
    title: "Delete this record?",
    description:
      "This cannot be undone. Re-log the record manually if you need a corrected version.",
    rows: [
      ["What", summary],
      ["Record ID", id],
    ],
    confirmLabel: "Delete",
    variant: "danger",
  });
  if (!ok) return;
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

// ─── Edit-record modal ─────────────────────────────────────────────────
//
// Identity fields (studentId / ownerType / ownerId / memberUidsAtCreation /
// familyMembershipCount) are NOT exposed in the form — they're stripped
// from the patch in db.js as a second line of defense too. To "change"
// who a record belongs to, admin must delete and re-log.

const FIELD_DEFS = {
  membership: [
    { name: "tier", label: "Tier", type: "text", required: true },
    { name: "validFrom", label: "Valid from", type: "date", required: true },
    { name: "validUntil", label: "Valid until", type: "date", required: true },
    { name: "purchaseDate", label: "Purchase date", type: "date", required: true },
    { name: "notes", label: "Notes", type: "textarea", required: false },
  ],
  purchase: [
    { name: "type", label: "Type", type: "select", options: [["private", "Private"], ["group", "Group"]], required: true },
    { name: "hours", label: "Hours", type: "number", required: true, min: 0.5, step: 0.5 },
    { name: "purchaseDate", label: "Date", type: "date", required: true },
    { name: "notes", label: "Notes", type: "textarea", required: false },
  ],
  used: [
    { name: "date", label: "Date", type: "date", required: true },
    { name: "type", label: "Type", type: "select", options: [["private", "Private"], ["group", "Group"]], required: true },
    { name: "hours", label: "Hours", type: "number", required: true, min: 0.5, step: 0.5 },
    { name: "coachName", label: "Coach", type: "text", required: false },
    { name: "notes", label: "Notes", type: "textarea", required: false },
  ],
};

const TITLE_BY_KIND = {
  membership: "Edit membership",
  purchase: "Edit bulk lesson purchase",
  used: "Edit lesson",
};

let editDialog = null;
function buildEditDialog() {
  const dlg = document.createElement("dialog");
  dlg.id = "edit-record-dialog";
  dlg.className = "modal";
  dlg.innerHTML = `
    <form id="edit-record-form" class="form">
      <h2 id="edit-record-title">Edit</h2>
      <div id="edit-record-fields"></div>
      <div id="edit-record-error" class="field-error" hidden></div>
      <div class="btn-row">
        <button class="btn" type="submit">Save</button>
        <button class="btn btn-ghost" type="button" id="edit-record-cancel">Cancel</button>
      </div>
    </form>
  `;
  document.body.appendChild(dlg);
  return dlg;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
}

function buildFieldElement(def, initialValue) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.className = "label";
  label.setAttribute("for", `edit-${def.name}`);
  label.textContent = def.label;
  wrap.appendChild(label);

  let input;
  if (def.type === "textarea") {
    input = document.createElement("textarea");
    input.className = "textarea";
    input.value = initialValue ?? "";
  } else if (def.type === "select") {
    input = document.createElement("select");
    input.className = "select";
    for (const [v, l] of def.options) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = l;
      input.appendChild(opt);
    }
    input.value = initialValue ?? "";
  } else {
    input = document.createElement("input");
    input.className = "input";
    input.type = def.type;
    input.value = initialValue ?? "";
    if (def.min !== undefined) input.min = def.min;
    if (def.step !== undefined) input.step = def.step;
  }
  input.id = `edit-${def.name}`;
  input.name = def.name;
  if (def.required) input.required = true;
  wrap.appendChild(input);
  return wrap;
}

function getInitialValue(def, record) {
  const raw = record[def.name];
  if (def.type === "date") return formatDateInput(toDate(raw));
  return raw == null ? "" : String(raw);
}

function readFieldValues(defs, container) {
  const out = {};
  for (const def of defs) {
    const node = container.querySelector(`#edit-${def.name}`);
    let v = node.value;
    if (def.type === "number") v = v === "" ? null : Number(v);
    else if (def.type === "date") v = v ? parseDateInput(v) : null;
    else if (def.type === "text" || def.type === "textarea") v = typeof v === "string" ? v.trim() : v;
    out[def.name] = v;
  }
  return out;
}

function computeDiffRows(defs, record, newValues) {
  const rows = [];
  for (const def of defs) {
    const oldRaw = record[def.name];
    const newRaw = newValues[def.name];
    let oldStr;
    let newStr;
    if (def.type === "date") {
      const od = toDate(oldRaw);
      oldStr = od ? formatDate(od) : "(empty)";
      newStr = newRaw ? formatDate(newRaw) : "(empty)";
    } else if (def.type === "number") {
      oldStr = oldRaw == null ? "(empty)" : String(oldRaw);
      newStr = newRaw == null ? "(empty)" : String(newRaw);
    } else {
      oldStr = oldRaw ? String(oldRaw) : "(empty)";
      newStr = newRaw ? String(newRaw) : "(empty)";
    }
    if (oldStr !== newStr) rows.push([def.label, `${oldStr} → ${newStr}`]);
  }
  return rows;
}

function buildPatch(defs, record, newValues) {
  const patch = {};
  for (const def of defs) {
    const oldRaw = record[def.name];
    const newRaw = newValues[def.name];
    if (def.type === "date") {
      const oms = toDate(oldRaw)?.getTime() ?? null;
      const nms = newRaw ? newRaw.getTime() : null;
      if (oms !== nms) patch[def.name] = newRaw;
    } else if (def.type === "number") {
      if ((oldRaw ?? null) !== (newRaw ?? null)) patch[def.name] = newRaw;
    } else if ((oldRaw || "") !== (newRaw || "")) {
      patch[def.name] = newRaw || "";
    }
  }
  return patch;
}

function validatePatch(kind, defs, values) {
  for (const def of defs) {
    if (def.required && (values[def.name] == null || values[def.name] === "")) {
      throw new Error(`${def.label} is required.`);
    }
  }
  if (kind === "membership" && values.validFrom && values.validUntil
      && values.validUntil < values.validFrom) {
    throw new Error("Valid-until must be on or after valid-from.");
  }
  if ((kind === "purchase" || kind === "used") && values.hours != null && values.hours <= 0) {
    throw new Error("Hours must be greater than 0.");
  }
}

function findRecord(kind, id) {
  if (kind === "membership") return state.memberships.find((m) => m.id === id);
  if (kind === "purchase") return state.purchases.find((p) => p.id === id);
  if (kind === "used") return state.used.find((u) => u.id === id);
  return null;
}

function applyUpdate(kind, id, patch) {
  if (kind === "membership") return updateMembershipRecord(id, patch);
  if (kind === "purchase") return updateLessonPurchaseRecord(id, patch);
  if (kind === "used") return updateLessonUsedRecord(id, patch);
  return Promise.reject(new Error(`Unknown record kind: ${kind}`));
}

async function onEditRecord(kind, id) {
  const record = findRecord(kind, id);
  if (!record) {
    showToast("That record is gone — refresh and try again.", "error");
    return;
  }
  if (!editDialog) editDialog = buildEditDialog();
  const dlg = editDialog;

  const defs = FIELD_DEFS[kind];
  const title = dlg.querySelector("#edit-record-title");
  const fields = dlg.querySelector("#edit-record-fields");
  const form = dlg.querySelector("#edit-record-form");
  const errEl = dlg.querySelector("#edit-record-error");
  const saveBtn = form.querySelector("button[type=submit]");
  const cancelBtn = dlg.querySelector("#edit-record-cancel");

  title.textContent = TITLE_BY_KIND[kind] || "Edit";
  fields.innerHTML = "";
  for (const def of defs) {
    fields.appendChild(buildFieldElement(def, getInitialValue(def, record)));
  }
  errEl.hidden = true;
  saveBtn.disabled = false;
  saveBtn.textContent = "Save";

  cancelBtn.onclick = () => dlg.close("cancel");

  // Close on backdrop click (not on padding).
  dlg.onclick = (ev) => {
    const r = dlg.getBoundingClientRect();
    if (
      ev.clientY < r.top || ev.clientY > r.bottom
      || ev.clientX < r.left || ev.clientX > r.right
    ) {
      dlg.close("cancel");
    }
  };

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    errEl.hidden = true;
    try {
      const newValues = readFieldValues(defs, fields);
      validatePatch(kind, defs, newValues);
      // Re-fetch from current state in case the realtime listener updated
      // the record while the modal was open.
      const current = findRecord(kind, id) || record;
      const diffRows = computeDiffRows(defs, current, newValues);
      if (diffRows.length === 0) {
        dlg.close("save");
        return;
      }
      const ok = await confirmAction({
        title: `Save changes to this ${kind === "used" ? "lesson" : kind}?`,
        rows: diffRows,
        confirmLabel: "Save",
      });
      if (!ok) return;

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      const patch = buildPatch(defs, current, newValues);
      await applyUpdate(kind, id, patch);
      dlg.close("save");
      showToast("Saved.", "success");
      // Realtime listener refreshes the dashboard automatically.
    } catch (e) {
      errEl.textContent = e.message || "Save failed.";
      errEl.hidden = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  };

  dlg.showModal();
}
