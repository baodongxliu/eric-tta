import { requestPasswordReset } from "../auth.js";

const form = document.getElementById("reset-form");
const errEl = document.getElementById("error");
const okEl = document.getElementById("success");
const btn = document.getElementById("submit-btn");

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  errEl.hidden = true;
  okEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    const email = document.getElementById("email").value.trim();
    await requestPasswordReset(email);
    // We always show success (don't leak whether the email exists).
    okEl.hidden = false;
    form.reset();
  } catch (e) {
    // Surface only network/quota issues; account-not-found is hidden.
    const code = e?.code || "";
    if (code.includes("invalid-email")) {
      errEl.textContent = "That email doesn't look right.";
      errEl.hidden = false;
    } else if (code.includes("too-many-requests")) {
      errEl.textContent = "Too many attempts — try again in a few minutes.";
      errEl.hidden = false;
    } else if (code.includes("user-not-found")) {
      // Pretend it worked to avoid email enumeration.
      okEl.hidden = false;
      form.reset();
    } else {
      errEl.textContent = e?.message || "Could not send reset email.";
      errEl.hidden = false;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Send reset link";
  }
});
