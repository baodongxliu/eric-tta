import { requireAdmin } from "../auth.js";
import { listAllStudents, logLessonPurchase } from "../db.js";
import { renderHeader, todayInput, parseDateInput, showToast } from "../ui.js";

(async () => {
  const { user, profile } = await requireAdmin();
  renderHeader({ profile, active: "log-purchase" });

  const students = (await listAllStudents()).sort((a, b) =>
    (a.displayName || a.email).localeCompare(b.displayName || b.email)
  );

  const sel = document.getElementById("student-id");
  for (const s of students) {
    const opt = document.createElement("option");
    opt.value = s.uid;
    opt.textContent = `${s.displayName || ""} (${s.email})`;
    sel.appendChild(opt);
  }

  document.getElementById("purchase-date").value = todayInput();

  document.getElementById("form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const errEl = document.getElementById("error");
    errEl.hidden = true;
    const btn = document.getElementById("submit-btn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const studentId = sel.value;
      const type = document.getElementById("type").value;
      const hours = Number(document.getElementById("hours").value);
      const purchaseDate = parseDateInput(document.getElementById("purchase-date").value);
      const notes = document.getElementById("notes").value;

      if (!studentId) throw new Error("Pick a student.");
      if (!hours || hours <= 0) throw new Error("Hours must be greater than 0.");

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
