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
  showToast,
  populateStudentTypeahead,
} from "../ui.js";

(async () => {
  const { user, profile } = await requireAdmin();
  renderHeader({ profile, active: "log-used" });

  const students = (await listAllStudents()).sort((a, b) =>
    (a.displayName || a.email).localeCompare(b.displayName || b.email)
  );
  const sel = document.getElementById("student-id");
  const datalist = document.getElementById("student-list");
  const resolveStudentUid = populateStudentTypeahead(sel, datalist, students);

  document.getElementById("date").value = todayInput();

  // Live balance preview.
  const checkBalance = async () => {
    const studentId = resolveStudentUid(sel.value);
    const type = document.getElementById("type").value;
    const hours = Number(document.getElementById("hours").value || 0);
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
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const studentId = resolveStudentUid(sel.value);
      const date = parseDateInput(document.getElementById("date").value);
      const type = document.getElementById("type").value;
      const hours = Number(document.getElementById("hours").value);
      const coachName = document.getElementById("coach").value.trim();
      const notes = document.getElementById("notes").value;

      if (!studentId) throw new Error("Pick a student from the suggestions list.");
      if (!hours || hours <= 0) throw new Error("Hours must be greater than 0.");

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
      document.getElementById("hours").value = "1";
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
