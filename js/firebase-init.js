import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// REPLACE BOTH BLOCKS with the web configs from your Firebase console.
// Project settings → General → Your apps → Web app → Config.
//
// One block per environment; the app auto-picks dev when running on
// localhost/127.0.0.1 and prod everywhere else (GitHub Pages, custom
// domain, etc.).

const PROD_CONFIG = {
  apiKey: "AIzaSyDDiEi93TisVF1S_6fvBpMHmaySzuKwr24",
  authDomain: "eric-tta-prod.firebaseapp.com",
  projectId: "eric-tta-prod",
  storageBucket: "eric-tta-prod.firebasestorage.app",
  messagingSenderId: "122385631115",
  appId: "1:122385631115:web:339cc620917596f3d1518e"
};

const DEV_CONFIG = {
  apiKey: "AIzaSyAfZIAN3B5tghLM0hEu1BNJ1xz1HCFEwC8",
  authDomain: "eric-tta.firebaseapp.com",
  projectId: "eric-tta",
  storageBucket: "eric-tta.firebasestorage.app",
  messagingSenderId: "238931496658",
  appId: "1:238931496658:web:473c59651d89b89d0da70b"
};

const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
export const isDev =
  typeof location !== "undefined" && DEV_HOSTS.has(location.hostname);
export const firebaseConfig = isDev ? DEV_CONFIG : PROD_CONFIG;

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// Fixed-position pill so admin can never confuse the dev environment with
// prod at a glance. Renders on every page (auth pages too) because this
// module is imported by all of them.
if (isDev && typeof document !== "undefined") {
  const mountBadge = () => {
    if (document.getElementById("env-badge")) return;
    const badge = document.createElement("div");
    badge.id = "env-badge";
    badge.className = "env-badge";
    badge.textContent = `DEV · ${firebaseConfig.projectId}`;
    badge.title =
      "Connected to the dev Firebase project. This is sandbox data — not prod.";
    document.body.appendChild(badge);
  };
  if (document.body) mountBadge();
  else document.addEventListener("DOMContentLoaded", mountBadge);
}
