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
} from "../ui.js";

let students = [];
let groups = [];

(async () => {
  const { user, profile } = await requireAdmin();
  renderHeader({ profile, active: "log-membership" });

  [students, groups] = await Promise.all([listAllStudents(), listFamilyGroups()]);
  students.sort((a, b) =>
    (a.displayName || a.email).localeCompare(b.displayName || b.email)
  );
  groups.sort((a, b) => a.name.localeCompare(b.name));

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
  const sel = document.getElementById("owner-id");
  sel.innerHTML = "";
  const opts =
    ownerType === "family"
      ? groups.map((g) => ({ value: g.id, label: g.name }))
      : students.map((s) => ({ value: s.uid, label: `${s.displayName || ""} (${s.email})` }));
  if (opts.length === 0) {
    sel.innerHTML = `<option value="">— none available —</option>`;
    return;
  }
  for (const o of opts) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
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
    const ownerId = document.getElementById("owner-id").value;
    const tier = document.getElementById("tier").value.trim();
    const purchaseDate = parseDateInput(document.getElementById("purchase-date").value);
    const validFrom = parseDateInput(document.getElementById("valid-from").value);
    const validUntil = parseDateInput(document.getElementById("valid-until").value);
    const notes = document.getElementById("notes").value;

    if (!ownerId) throw new Error("Pick an owner.");
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
