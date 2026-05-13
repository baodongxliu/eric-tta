import { requireStudent } from "../auth.js";
import {
  listMembershipsForStudent,
  listLessonPurchasesForStudent,
  listLessonsUsedForStudent,
} from "../db.js";
import { buildTimeline, filterByDateRange } from "../balance.js";
import {
  renderHeader,
  formatDate,
  formatDateInput,
  parseDateInput,
  todayInput,
  escapeHtml,
  el,
} from "../ui.js";

const state = {
  timeline: [],
  typeFilter: "all", // all | membership | purchase | used
};

(async () => {
  const { user, profile } = await requireStudent();
  renderHeader({ profile, active: "history" });

  const [memberships, purchases, used] = await Promise.all([
    // Pass currentFamilyGroupId so the helper unions the current-backref
    // query with the historical-snapshot query — that catches both members
    // who joined after a family membership was logged AND former members
    // whose snapshot still includes them.
    listMembershipsForStudent(user.uid, profile?.familyGroupId || null),
    listLessonPurchasesForStudent(user.uid),
    listLessonsUsedForStudent(user.uid),
  ]);
  state.timeline = buildTimeline({ memberships, purchases, used });

  // Wire filters.
  document.getElementById("from").addEventListener("change", render);
  document.getElementById("to").addEventListener("change", render);
  document.getElementById("today-btn").addEventListener("click", () => {
    const t = todayInput();
    document.getElementById("from").value = t;
    document.getElementById("to").value = t;
    render();
  });
  document.getElementById("clear-btn").addEventListener("click", () => {
    document.getElementById("from").value = "";
    document.getElementById("to").value = "";
    state.typeFilter = "all";
    render();
  });
  document.querySelectorAll("#type-filters .chip").forEach((b) => {
    b.addEventListener("click", () => {
      state.typeFilter = b.dataset.type;
      render();
    });
  });

  render();
})();

function formatHours(n) {
  if (n == null || isNaN(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function render() {
  const from = parseDateInput(document.getElementById("from").value);
  const to = parseDateInput(document.getElementById("to").value);
  let items = filterByDateRange(state.timeline, from, to);
  if (state.typeFilter !== "all") {
    items = items.filter((x) => x.kind === state.typeFilter);
  }

  document.querySelectorAll("#type-filters .chip").forEach((b) => {
    b.classList.toggle("chip-good", b.dataset.type === state.typeFilter);
  });

  const root = document.getElementById("results");
  if (items.length === 0) {
    root.innerHTML = `<p class="table-empty">No activity matches your filters.</p>`;
    return;
  }
  const table = el("table", { class: "table" },
    el("thead", {}, el("tr", {},
      el("th", {}, "Date"),
      el("th", {}, "Type"),
      el("th", {}, "Detail"),
      el("th", {}, "Notes"),
    )),
  );
  const tbody = el("tbody");
  for (const item of items) tbody.appendChild(rowFor(item));
  table.appendChild(tbody);
  root.innerHTML = "";
  root.appendChild(table);
}

function rowFor(item) {
  if (item.kind === "membership") {
    return el("tr", {},
      el("td", {}, formatDate(item.date)),
      el("td", { html: `<span class="chip chip-membership">Membership</span>` }),
      el("td", {}, `${item.tier} · ${formatDate(item.validFrom)} → ${formatDate(item.validUntil)}`),
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
  const chip = item.type === "private" ? "chip-private" : "chip-group";
  return el("tr", {},
    el("td", {}, formatDate(item.date)),
    el("td", { html: `<span class="chip ${chip}">${escapeHtml(item.type)} lesson</span>` }),
    el("td", {}, `−${formatHours(item.hours)} h${item.coachName ? ` · Coach ${item.coachName}` : ""}`),
    el("td", {}, item.notes || ""),
  );
}
