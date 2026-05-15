import { requireAdmin } from "../auth.js";
import { listAllStudents, logLessonPurchase } from "../db.js";
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
  renderHeader({ profile, active: "log-purchase" });

  const students = (await listAllStudents()).sort((a, b) =>
    (a.displayName || a.email).localeCompare(b.displayName || b.email)
  );

  const sel = document.getElementById("student-id");
  const resolveStudentUid = populateStudentTypeahead(sel, null, students);

  document.getElementById("purchase-date").value = todayInput();

  document.getElementById("form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const errEl = document.getElementById("error");
    errEl.hidden = true;
    const btn = document.getElementById("submit-btn");
    try {
      const studentId = resolveStudentUid(sel.value);
      const type = document.getElementById("type").value;
      const hours = Number(document.getElementById("hours").value);
      const purchaseDate = parseDateInput(document.getElementById("purchase-date").value);
      const notes = document.getElementById("notes").value;

      if (!studentId) throw new Error("Pick a student from the suggestions list.");
      if (!hours || hours <= 0) throw new Error("Hours must be greater than 0.");

      const ok = await confirmAction({
        title: "Log this bulk purchase?",
        description: "This adds hours to the student's balance.",
        rows: [
          ["Student", sel.value],
          ["Type", type],
          ["Hours", `+${hours}`],
          ["Date", formatDate(purchaseDate || new Date())],
          ["Notes", notes || "—"],
        ],
        confirmLabel: "Save purchase",
      });
      if (!ok) return;

      btn.disabled = true;
      btn.textContent = "Saving…";
      await logLessonPurchase({
        studentId,
        type,
        hours,
        purchaseDate: purchaseDate || new Date(),
        notes,
        createdBy: user.uid,
      });
      showToast("Purchase saved.", "success");
      document.getElementById("form").reset();
      document.getElementById("purchase-date").value = todayInput();
    } catch (e) {
      errEl.textContent = e.message || "Could not save.";
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });
})();
