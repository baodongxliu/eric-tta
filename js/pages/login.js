import { signIn, signOutUser, waitForAuth, goDashboard } from "../auth.js";

// If already signed in, skip the form.
waitForAuth().then((res) => {
  if (res) goDashboard(res.profile?.role);
});

const form = document.getElementById("login-form");
const errEl = document.getElementById("error");
const btn = document.getElementById("submit-btn");

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    await signIn(email, password);
    const res = await waitForAuth();
    if (!res?.profile?.role) {
      await signOutUser();
      throw new Error("This account has no profile yet. Re-register or contact admin.");
    }
    goDashboard(res.profile.role);
  } catch (e) {
    errEl.textContent = friendly(e);
    errEl.hidden = false;
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});

function friendly(e) {
  const code = e?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "Email or password is incorrect.";
  if (code.includes("invalid-email")) return "That email doesn't look right.";
  if (code.includes("too-many-requests")) return "Too many attempts — try again in a few minutes.";
  return e?.message || "Sign in failed.";
}
