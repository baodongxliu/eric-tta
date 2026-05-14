import { requireAdmin } from "../auth.js";
import {
  listAllStudents,
  listFamilyGroups,
  logMembership,
} from "../db.js";
import {
  renderHeader,
  todayInput,
  parseDateInput,
  formatDateInput,
  addDays,
  showToast,
  populateStudentTypeahead,
} from "../ui.js";

let students = [];
let groups = [];
let resolveStudentUid = () => null;

(async () => {
  const { user, profile } = await requireAdmin();
  renderHeader({ profile, active: "log-membership" });

  [students, groups] = await Promise.all([listAllStudents(), listFamilyGroups()]);
  students.sort((a, b) =>
    (a.displayName || a.email).localeCompare(b.displayName || b.email)
  );
  groups.sort((a, b) => a.name.localeCompare(b.name));

  const studentInput = document.getElementById("owner-id-student");
  const studentDatalist = document.getElementById("owner-student-list");
  resolveStudentUid = populateStudentTypeahead(studentInput, studentDatalist, students);

  // Defaults
  const t = todayInput();
  document.getElementById("purchase-date").value = t;
  document.getElementById("valid-from").value = t;
  document.getElementById("valid-until").value = formatDateInput(addDays(new Date(), 365));

  // When valid-from changes, push valid-until to +1 year if untouched-ish.
  document.getElementById("valid-from").addEventListener("change", () => {
    const from = parseDateInput(document.getElementById("valid-from").value);
    if (from) document.getElementById("valid-until").value = formatDateInput(addDays(from, 365));
  });

  document.getElementById("owner-type").addEventListener("change", populateOwners);
  populateOwners();

  document.getElementById("form").addEventListener("submit", (ev) =>
    onSubmit(ev, user.uid)
  );
})();

function populateOwners() {
  const ownerType = document.getElementById("owner-type").value;
  const studentInput = document.getElementById("owner-id-student");
  const familySelect = document.getElementById("owner-id-family");
  const isFamily = ownerType === "family";

  studentInput.hidden = isFamily;
  studentInput.required = !isFamily;
  familySelect.hidden = !isFamily;
  familySelect.required = isFamily;

  if (isFamily) {
    // Empty / 1-member groups can't own a family membership; hide them
    // from the picker. (db.logMembership also enforces this server-side.)
    const eligibleGroups = groups.filter((g) => (g.memberUids || []).length >= 2);
    familySelect.innerHTML = "";
    if (eligibleGroups.length === 0) {
      familySelect.innerHTML = `<option value="">— none available —</option>`;
      return;
    }
    for (const g of eligibleGroups) {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.name;
      familySelect.appendChild(opt);
    }
  } else {
    // Reset stale input value when switching back to student picker.
    studentInput.value = "";
  }
}

async function onSubmit(ev, adminUid) {
  ev.preventDefault();
  const errEl = document.getElementById("error");
  errEl.hidden = true;
  const btn = document.getElementById("submit-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const ownerType = document.getElementById("owner-type").value;
    // Family-owner writes use a transaction (cross-doc validation) and don't
    // queue offline. Student-owner writes are still offline-friendly addDocs.
    if (ownerType === "family" && !navigator.onLine) {
      throw new Error("Logging a family membership needs an online connection.");
    }
    const ownerId =
      ownerType === "family"
        ? document.getElementById("owner-id-family").value
        : resolveStudentUid(document.getElementById("owner-id-student").value);
    const tier = document.getElementById("tier").value.trim();
    const purchaseDate = parseDateInput(document.getElementById("purchase-date").value);
    const validFrom = parseDateInput(document.getElementById("valid-from").value);
    const validUntil = parseDateInput(document.getElementById("valid-until").value);
    const notes = document.getElementById("notes").value;

    if (!ownerId) {
      throw new Error(
        ownerType === "family"
          ? "Pick a family group."
          : "Pick a student from the suggestions list."
      );
    }
    if (!tier) throw new Error("Tier is required.");
    if (!validFrom || !validUntil) throw new Error("Both valid-from and valid-until are required.");
    if (validUntil < validFrom) throw new Error("Valid-until must be on or after valid-from.");

    await logMembership({
      ownerType,
      ownerId,
      tier,
      validFrom,
      validUntil,
      purchaseDate: purchaseDate || new Date(),
      notes,
      createdBy: adminUid,
    });
    showToast("Membership saved.", "success");
    document.getElementById("form").reset();
    document.getElementById("owner-id-student").value = "";
    // Restore date defaults.
    const t = todayInput();
    document.getElementById("purchase-date").value = t;
    document.getElementById("valid-from").value = t;
    document.getElementById("valid-until").value = formatDateInput(addDays(new Date(), 365));
    populateOwners();
  } catch (e) {
    errEl.textContent = e.message || "Could not save.";
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
}
