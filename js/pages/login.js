import { signIn, signInWithGoogle, signOutUser, waitForAuth, goDashboard } from "../auth.js";

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

const googleBtn = document.getElementById("google-btn");
googleBtn?.addEventListener("click", async () => {
  errEl.hidden = true;
  googleBtn.disabled = true;
  try {
    await signInWithGoogle();
    const res = await waitForAuth();
    if (!res?.profile?.role) {
      await signOutUser();
      throw new Error("Sign-in succeeded but no profile was created. Try again.");
    }
    goDashboard(res.profile.role);
  } catch (e) {
    errEl.textContent = friendlyGoogle(e);
    errEl.hidden = false;
    googleBtn.disabled = false;
  }
});

function friendlyGoogle(e) {
  const code = e?.code || "";
  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request"))
    return "Sign-in cancelled.";
  if (code.includes("popup-blocked"))
    return "Your browser blocked the popup. Allow popups for this site and try again.";
  if (code.includes("account-exists-with-different-credential"))
    return "This email is already registered with a password. Sign in with email/password instead.";
  if (code.includes("network-request-failed"))
    return "Network error — check your connection.";
  if (code.includes("unauthorized-domain"))
    return "This domain isn't authorized in Firebase. Add it under Authentication → Settings → Authorized domains.";
  return e?.message || "Google sign-in failed.";
}
