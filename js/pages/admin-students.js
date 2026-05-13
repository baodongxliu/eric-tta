import { requireAdmin } from "../auth.js";
import {
  listAllStudents,
  listFamilyGroups,
  listAllMemberships,
  listAllLessonPurchases,
  listAllLessonsUsed,
  commitFamilyGroupCreate,
  commitFamilyGroupTransfer,
  commitFamilyGroupDissolve,
  commitStudentDisplayName,
} from "../db.js";
import {
  computeMembershipStatus,
  computeHoursBalance,
} from "../balance.js";
import { renderHeader, formatDate, escapeHtml, el, showToast } from "../ui.js";

const state = {
  students: [],
  groups: [],
  memberships: [],
  purchases: [],
  used: [],
  search: "",
};

(async () => {
  const { profile } = await requireAdmin();
  renderHeader({ profile, active: "students" });

  await loadAll();
  renderGroups();
  renderStudents();
  wireGroupForm();

  document.getElementById("search").addEventListener("input", (e) => {
    state.search = e.target.value.toLowerCase().trim();
    renderStudents();
  });
})();

async function loadAll() {
  const [students, groups, memberships, purchases, used] = await Promise.all([
    listAllStudents(),
    listFamilyGroups(),
    listAllMemberships(),
    listAllLessonPurchases(),
    listAllLessonsUsed(),
  ]);
  state.students = students.sort((a, b) =>
    (a.displayName || a.email || "").localeCompare(b.displayName || b.email || "")
  );
  state.groups = groups;
  state.memberships = memberships;
  state.purchases = purchases;
  state.used = used;
}

function renderGroups() {
  const root = document.getElementById("groups-list");
  if (state.groups.length === 0) {
    root.innerHTML = `<p class="table-empty">No family groups yet.</p>`;
  } else {
    const t = el("table", { class: "table" },
      el("thead", {}, el("tr", {},
        el("th", {}, "Group"),
        el("th", {}, "Members"),
        el("th", {}, ""),
      )),
    );
    const tb = el("tbody");
    const byUid = new Map(state.students.map((s) => [s.uid, s]));
    for (const g of state.groups) {
      const names = (g.memberUids || [])
        .map((u) => byUid.get(u)?.displayName || byUid.get(u)?.email || u)
        .join(", ");
      const dissolveBtn = el("button", {
        type: "button",
        class: "btn btn-ghost",
        onClick: () => onDissolveGroup(g),
      }, "Dissolve");
      tb.appendChild(el("tr", {},
        el("td", {}, g.name),
        el("td", {}, names || "—"),
        el("td", {}, dissolveBtn),
      ));
    }
    t.appendChild(tb);
    root.innerHTML = "";
    root.appendChild(t);
  }

  // Refresh member-picker chips.
  const picker = document.getElementById("group-members");
  picker.innerHTML = "";
  for (const s of state.students) {
    const btn = el("button", {
      type: "button",
      class: "chip",
      "data-uid": s.uid,
      onClick: (ev) => {
        ev.preventDefault();
        btn.classList.toggle("chip-good");
      },
    }, s.displayName || s.email);
    picker.appendChild(btn);
  }
}

function wireGroupForm() {
  document.getElementById("group-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = document.getElementById("group-name").value.trim();
    const picked = [...document.querySelectorAll("#group-members .chip-good")].map(
      (c) => c.dataset.uid
    );
    if (picked.length < 2 || picked.length > 4) {
      showToast("Pick 2 to 4 members.", "error");
      return;
    }
    // Family-group writes use Firestore transactions, which require a live
    // backend connection — they don't queue offline like our other admin
    // writes. Refuse explicitly rather than letting the transaction error.
    if (!navigator.onLine) {
      showToast("Family group changes need an online connection.", "error");
      return;
    }
    try {
      await commitFamilyGroupCreate({ name, picked });
      showToast("Family group created.", "success");
      document.getElementById("group-form").reset();
      await loadAll();
      renderGroups();
      renderStudents();
    } catch (e) {
      showToast(e.message || "Could not create group.", "error");
    }
  });
}

async function onDissolveGroup(group) {
  const ok = confirm(
    `Dissolve "${group.name}"? Each member will revert to no family.\n\nThis is the only way to clear a 2-member family or empty group; it can't proceed if family-tier memberships are still attached.`
  );
  if (!ok) return;
  if (!navigator.onLine) {
    showToast("Dissolving a family needs an online connection.", "error");
    return;
  }
  try {
    await commitFamilyGroupDissolve(group.id);
    showToast(`Dissolved "${group.name}".`, "success");
    await loadAll();
    renderGroups();
    renderStudents();
  } catch (e) {
    showToast(e.message || "Could not dissolve group.", "error");
  }
}

function renderStudents() {
  const root = document.getElementById("students-list");
  const today = new Date();
  const groupById = new Map(state.groups.map((g) => [g.id, g]));

  const rows = state.students
    .filter((s) => {
      if (!state.search) return true;
      return (
        (s.displayName || "").toLowerCase().includes(state.search) ||
        (s.email || "").toLowerCase().includes(state.search)
      );
    })
    .map((s) => {
      const ownMs = state.memberships.filter(
        (m) => m.ownerType === "student" && m.ownerId === s.uid
      );
      const famMs = s.familyGroupId
        ? state.memberships.filter(
            (m) => m.ownerType === "family" && m.ownerId === s.familyGroupId
          )
        : [];
      const ms = computeMembershipStatus([...ownMs, ...famMs], today);
      const sp = state.purchases.filter((p) => p.studentId === s.uid);
      const su = state.used.filter((u) => u.studentId === s.uid);
      const priv = computeHoursBalance(sp, su, "private");
      const grp = computeHoursBalance(sp, su, "group");
      return { s, ms, priv, grp };
    });

  if (rows.length === 0) {
    root.innerHTML = `<p class="table-empty">No students match your search.</p>`;
    return;
  }

  const t = el("table", { class: "table" },
    el("thead", {}, el("tr", {},
      el("th", {}, "Name"),
      el("th", {}, "Email"),
      el("th", {}, "Family"),
      el("th", {}, "Membership"),
      el("th", {}, "Private h"),
      el("th", {}, "Group h"),
      el("th", {}, ""),
    )),
  );
  const tb = el("tbody");
  for (const r of rows) {
    const familyName = r.s.familyGroupId
      ? groupById.get(r.s.familyGroupId)?.name || "—"
      : "—";
    const msHtml =
      r.ms.status === "active"
        ? `<span class="chip chip-good">${escapeHtml(r.ms.tier || "")} · ${r.ms.daysRemaining}d</span>`
        : r.ms.status === "expired"
          ? `<span class="chip chip-bad">Expired</span>`
          : `<span class="chip">None</span>`;
    tb.appendChild(el("tr", {},
      el("td", {}, r.s.displayName || ""),
      el("td", {}, r.s.email || ""),
      el("td", {}, familyName),
      el("td", { html: msHtml }),
      el("td", { html: cellForHours(r.priv.remaining) }),
      el("td", { html: cellForHours(r.grp.remaining) }),
      el("td", {}, makeEditBtn(r.s)),
    ));
  }
  t.appendChild(tb);
  root.innerHTML = "";
  root.appendChild(t);
}

function makeEditBtn(student) {
  return el("button", {
    type: "button",
    class: "btn btn-ghost",
    onClick: () => openEditDialog(student),
  }, "Edit");
}

function openEditDialog(student) {
  const dlg = document.getElementById("edit-dialog");
  const form = document.getElementById("edit-form");
  const nameEl = document.getElementById("edit-name");
  const groupEl = document.getElementById("edit-group");
  const errEl = document.getElementById("edit-error");
  const saveBtn = document.getElementById("edit-save");
  const cancelBtn = document.getElementById("edit-cancel");

  // Captured at open time so we can detect a stale dialog (admin B moved this
  // student between our open and our submit) inside the transaction.
  const initialGroupId = student.familyGroupId || null;

  document.getElementById("edit-title").textContent = `Edit ${student.displayName || "student"}`;
  document.getElementById("edit-email").textContent = student.email || "";
  nameEl.value = student.displayName || "";

  groupEl.innerHTML = "";
  groupEl.appendChild(new Option("— none —", ""));
  for (const g of state.groups) {
    const opt = new Option(g.name, g.id);
    if (student.familyGroupId === g.id) opt.selected = true;
    groupEl.appendChild(opt);
  }

  errEl.hidden = true;
  saveBtn.disabled = false;
  saveBtn.textContent = "Save";

  cancelBtn.onclick = () => dlg.close("cancel");

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    errEl.hidden = true;

    const newName = nameEl.value.trim();
    const newGroupId = groupEl.value || null;
    const groupChangeRequested = newGroupId !== initialGroupId;

    // Only the family-group path needs a live connection (it uses a
    // transaction); pure name edits queue offline like the rest of admin.
    if (groupChangeRequested && !navigator.onLine) {
      errEl.textContent = "Family group changes need an online connection.";
      errEl.hidden = false;
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      if (!newName) throw new Error("Display name is required.");

      if (groupChangeRequested) {
        await commitFamilyGroupTransfer({
          uid: student.uid,
          displayName: newName,
          toGroupId: newGroupId,
          expectedFromGroupId: initialGroupId,
        });
      } else {
        await commitStudentDisplayName({
          uid: student.uid,
          displayName: newName,
        });
      }

      dlg.close("save");
      showToast("Saved.", "success");
      await loadAll();
      renderGroups();
      renderStudents();
    } catch (e) {
      errEl.textContent = e.message || "Save failed.";
      errEl.hidden = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  };

  // Compare to the dialog's bounding rect so clicks on the modal's own
  // padding (which target <dialog> but look "inside" to the user) don't dismiss.
  dlg.onclick = (ev) => {
    const r = dlg.getBoundingClientRect();
    if (
      ev.clientY < r.top ||
      ev.clientY > r.bottom ||
      ev.clientX < r.left ||
      ev.clientX > r.right
    ) {
      dlg.close("cancel");
    }
  };

  dlg.showModal();
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
