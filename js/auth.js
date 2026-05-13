import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUp(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) await updateProfile(cred.user, { displayName });
  await setDoc(doc(db, "users", cred.user.uid), {
    email,
    displayName: displayName || "",
    role: "student",
    familyGroupId: null,
    createdAt: serverTimestamp(),
  });
  return cred.user;
}

export function signOutUser() {
  return fbSignOut(auth);
}

export function requestPasswordReset(email) {
  return sendPasswordResetEmail(auth, email);
}

// Google sign-in. First-time sign-in auto-creates the /users/{uid} doc
// (we don't get a separate "register" step for popup providers) — this
// keeps the orphan-profile guard in requireAuth from bouncing them.
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  const userRef = doc(db, "users", cred.user.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, {
      email: cred.user.email || "",
      displayName: cred.user.displayName || "",
      role: "student",
      familyGroupId: null,
      createdAt: serverTimestamp(),
    });
  }
  return cred.user;
}

export function waitForAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (!user) return resolve(null);
      const snap = await getDoc(doc(db, "users", user.uid));
      resolve({ user, profile: snap.exists() ? snap.data() : null });
    });
  });
}

function appRoot() {
  // If we're inside /admin/, going up one level reaches the app root.
  return location.pathname.includes("/admin/") ? "../" : "./";
}

export function goHome() {
  location.href = appRoot() + "index.html";
}

export function goDashboard(role) {
  location.href = appRoot() + (role === "admin" ? "admin/index.html" : "dashboard.html");
}

export async function requireAuth() {
  const result = await waitForAuth();
  // An auth user with no /users profile is unusable (signup race, manual
  // deletion, or a Firestore write failure). Sign them out and bounce
  // home rather than letting the redirect chain loop.
  if (!result || !result.profile?.role) {
    if (result) await signOutUser();
    goHome();
    throw new Error("not signed in");
  }
  return result;
}

export async function requireStudent() {
  const result = await requireAuth();
  if (result.profile?.role !== "student") {
    goDashboard(result.profile?.role);
    throw new Error("not student");
  }
  return result;
}

export async function requireAdmin() {
  const result = await requireAuth();
  if (result.profile?.role !== "admin") {
    goDashboard(result.profile?.role);
    throw new Error("not admin");
  }
  return result;
}
