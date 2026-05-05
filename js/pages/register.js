import { signUp, waitForAuth, goDashboard } from "../auth.js";

waitForAuth().then((res) => {
  if (res) goDashboard(res.profile?.role);
});

const form = document.getElementById("register-form");
const errEl = document.getElementById("error");
const btn = document.getElementById("submit-btn");

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Creating…";
  try {
    const displayName = document.getElementById("displayName").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    await signUp(email, password, displayName);
    goDashboard("student");
  } catch (e) {
    errEl.textContent = friendly(e);
    errEl.hidden = false;
    btn.disabled = false;
    btn.textContent = "Create account";
  }
});

function friendly(e) {
  const code = e?.code || "";
  if (code.includes("email-already-in-use")) return "That email is already registered.";
  if (code.includes("weak-password")) return "Password is too short — use at least 6 characters.";
  if (code.includes("invalid-email")) return "That email doesn't look right.";
  return e?.message || "Could not create account.";
}
