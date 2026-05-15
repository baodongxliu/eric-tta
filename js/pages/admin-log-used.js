import { requireAdmin } from "../auth.js";
import {
  listAllStudents,
  listLessonPurchasesForStudent,
  listLessonsUsedForStudent,
  logLessonUsed,
} from "../db.js";
import { computeHoursBalance } from "../balance.js";
import {
  renderHeader,
  todayInput,
  parseDateInput,
  formatDate,
  showToast,
  populateStudentTypeahead,
  confirmAction,
} from "../ui.js";

(async () => {
  const { user, profile } = await requireAdmin();
  renderHeader({ profile, active: "log-used" });

  const students = (await listAllStudents()).sort((a, b) =>
    (a.displayName || a.email).localeCompare(b.displayName || b.email)
  );
  const sel = document.getElementById("student-id");
  const resolveStudentUid = populateStudentTypeahead(sel, null, students);

  document.getElementById("date").value = todayInput();

  // Start/end time → hours derivation. The hours input is readonly and
  // gets its value from this computation; admin picks times, the number
  // appears automatically.
  const startEl = document.getElementById("start-time");
  const endEl = document.getElementById("end-time");
  const hoursEl = document.getElementById("hours");
  const recomputeHours = () => {
    const h = hoursFromTimes(startEl.value, endEl.value);
    hoursEl.value = h != null ? formatHoursForInput(h) : "";
  };
  startEl.addEventListener("change", () => {
    recomputeHours();
    checkBalanceSoon();
  });
  endEl.addEventListener("change", () => {
    recomputeHours();
    checkBalanceSoon();
  });

  // Live balance preview.
  const checkBalance = async () => {
    const studentId = resolveStudentUid(sel.value);
    const type = document.getElementById("type").value;
    const hours = Number(hoursEl.value || 0);
    const warn = document.getElementById("balance-warn");
    if (!studentId || !type || !hours) {
      warn.hidden = true;
      return;
    }
    try {
      const [purchases, used] = await Promise.all([
        listLessonPurchasesForStudent(studentId),
        listLessonsUsedForStudent(studentId),
      ]);
      const bal = computeHoursBalance(purchases, used, type);
      const after = bal.remaining - hours;
      if (after < 0) {
        warn.textContent = `Heads-up: this would put ${type} balance at ${after.toFixed(1)} h (currently ${bal.remaining.toFixed(1)} h).`;
        warn.hidden = false;
      } else {
        warn.hidden = true;
      }
    } catch {
      warn.hidden = true;
    }
  };
  // Throttle the input-driven check so typing "12.5" doesn't fire one
  // round-trip per keystroke. Discrete events (selects) run immediately.
  let checkBalanceTimer;
  const checkBalanceSoon = () => {
    clearTimeout(checkBalanceTimer);
    checkBalanceTimer = setTimeout(checkBalance, 250);
  };
  sel.addEventListener("change", checkBalance);
  document.getElementById("type").addEventListener("change", checkBalance);
  document.getElementById("hours").addEventListener("input", checkBalanceSoon);
  // Initial check after the dropdown auto-selects the first student.
  checkBalance();

  document.getElementById("form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const errEl = document.getElementById("error");
    errEl.hidden = true;
    const btn = document.getElementById("submit-btn");
    try {
      const studentId = resolveStudentUid(sel.value);
      const date = parseDateInput(document.getElementById("date").value);
      const type = document.getElementById("type").value;
      const startTime = startEl.value;
      const endTime = endEl.value;
      const hours = Number(hoursEl.value);
      const coachName = document.getElementById("coach").value.trim();
      const notes = document.getElementById("notes").value;

      if (!studentId) throw new Error("Pick a student from the suggestions list.");
      if (!startTime || !endTime) throw new Error("Start and end times are required.");
      if (!isHalfHour(startTime) || !isHalfHour(endTime)) {
        throw new Error("Times must land on :00 or :30 — lessons start on the half hour.");
      }
      if (!hours || hours <= 0) throw new Error("End time must be after start time.");

      const ok = await confirmAction({
        title: "Log this lesson?",
        description: "This deducts hours from the student's balance.",
        rows: [
          ["Student", sel.value],
          ["Date", formatDate(date || new Date())],
          ["Time", `${startTime} – ${endTime}`],
          ["Type", type],
          ["Hours", String(hours)],
          ["Coach", coachName || "—"],
          ["Notes", notes || "—"],
        ],
        confirmLabel: "Save lesson",
      });
      if (!ok) return;

      btn.disabled = true;
      btn.textContent = "Saving…";
      await logLessonUsed({
        studentId,
        date: date || new Date(),
        type,
        hours,
        coachName,
        notes,
        createdBy: user.uid,
      });
      showToast("Lesson saved.", "success");
      document.getElementById("form").reset();
      document.getElementById("date").value = todayInput();
      startEl.value = "";
      endEl.value = "";
      hoursEl.value = "";
      checkBalance();
    } catch (e) {
      errEl.textContent = e.message || "Could not save.";
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });
})();

// Returns decimal hours between two "HH:mm" strings, or null if either
// is missing, not on :00/:30, or end is not after start.
function hoursFromTimes(start, end) {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) return null;
  if (![0, 30].includes(sm) || ![0, 30].includes(em)) return null;
  const minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) return null;
  return minutes / 60;
}

// Render hours with up to 2 decimal places, trimming trailing zeros so
// 1.0 displays as "1" and 1.5 as "1.5".
function formatHoursForInput(h) {
  return Number(h.toFixed(2)).toString();
}

function isHalfHour(time) {
  if (!time) return false;
  const m = Number(time.split(":")[1]);
  return m === 0 || m === 30;
}
