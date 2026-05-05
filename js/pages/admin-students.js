import { requireAdmin } from "../auth.js";
import {
  listAllStudents,
  listFamilyGroups,
  listAllMemberships,
  listAllLessonPurchases,
  listAllLessonsUsed,
  createFamilyGroup,
  updateFamilyGroup,
  updateUserProfile,
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
      )),
    );
    const tb = el("tbody");
    const byUid = new Map(state.students.map((s) => [s.uid, s]));
    for (const g of state.groups) {
      const names = (g.memberUids || [])
        .map((u) => byUid.get(u)?.displayName || byUid.get(u)?.email || u)
        .join(", ");
      tb.appendChild(el("tr", {},
        el("td", {}, g.name),
        el("td", {}, names || "—"),
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
    try {
      // Pre-cleanup: any picked student already in another group must be
      // removed from that old group's memberUids first.
      const studentByUid = new Map(state.students.map((s) => [s.uid, s]));
      const oldGroupUpdates = new Map(); // groupId → new memberUids array
      for (const uid of picked) {
        const oldId = studentByUid.get(uid)?.familyGroupId;
        if (!oldId) continue;
        const oldGroup = state.groups.find((g) => g.id === oldId);
        if (!oldGroup) continue;
        const current = oldGroupUpdates.get(oldId) ?? oldGroup.memberUids ?? [];
        oldGroupUpdates.set(
          oldId,
          current.filter((u) => u !== uid)
        );
      }
      await Promise.all(
        [...oldGroupUpdates.entries()].map(([id, memberUids]) =>
          updateFamilyGroup(id, { memberUids })
        )
      );

      const ref = await createFamilyGroup(name, picked);
      await Promise.all(
        picked.map((uid) => updateUserProfile(uid, { familyGroupId: ref.id }))
      );
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
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      const newName = nameEl.value.trim();
      const newGroupId = groupEl.value || null;
      if (!newName) throw new Error("Display name is required.");

      await updateUserProfile(student.uid, {
        displayName: newName,
        familyGroupId: newGroupId,
      });

      // Keep familyGroups.memberUids consistent with users.familyGroupId.
      if (newGroupId !== student.familyGroupId) {
        if (student.familyGroupId) {
          const g = state.groups.find((x) => x.id === student.familyGroupId);
          if (g) {
            await updateFamilyGroup(g.id, {
              memberUids: (g.memberUids || []).filter((u) => u !== student.uid),
            });
          }
        }
        if (newGroupId) {
          const g = state.groups.find((x) => x.id === newGroupId);
          if (g && !(g.memberUids || []).includes(student.uid)) {
            await updateFamilyGroup(g.id, {
              memberUids: [...(g.memberUids || []), student.uid],
            });
          }
        }
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

  // Close on Escape (native <dialog> behavior) or click on the backdrop.
  // We compare against the dialog's bounding rect so clicks on the modal's
  // own padding (which are technically targeted at <dialog>) don't dismiss.
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
