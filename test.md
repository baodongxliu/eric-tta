# Local test walkthrough

Run the app on your laptop against a real Firebase project. ~25 minutes
total, including Firebase setup.

When every step in Phase 7 passes cleanly, the app is locally
ship-ready. GitHub Pages deploy is separate and comes after.

---

## Phase 1 — Prereqs (1 min)

```bash
node --version          # v18 or newer
cd /Users/baodongliu/work/eric-tta
npm install             # installs firebase-tools + http-server into ./node_modules
npx firebase --version  # confirms the local Firebase CLI works
```

No global npm installs required — everything is project-scoped. You also need a Google account for Firebase.

---

## Phase 2 — Create TWO Firebase projects: dev + prod (10 min, browser)

You'll create separate projects so local testing never touches prod data. The local app auto-picks the dev project on `localhost`; deployed (GitHub Pages) hits prod. A yellow "DEV" pill in the bottom-left of every page confirms you're on dev.

For each project (`eric-tta-dev` first, then `eric-tta-prod`):

1. <https://console.firebase.google.com> → **Add project**.
2. Name it `eric-tta-dev` (or `eric-tta-prod`). Disable Google Analytics. **Create project**.
3. Left rail: **Build → Authentication → Get started → Email/Password
   → Enable → Save**. Leave email-link off. Then on the same page,
   **Add new provider → Google → Enable**, fill in a project support
   email, **Save**. (The Continue-with-Google button stays harmless
   if you skip this — it'll just show `auth/operation-not-allowed`
   when clicked.)
4. Left rail: **Build → Firestore Database → Create database → Start in
   production mode → Region us-west1 → Enable**.
5. Top-left gear icon → **Project settings → General**. Scroll to
   **Your apps**, click `</>` (web). Nickname `eric-tta-web`. **Don't**
   check Hosting. **Register app**. Copy the `firebaseConfig` object
   that appears — keep both side-by-side, you'll paste them into
   different blocks of `js/firebase-init.js`.

For local-only smoke testing you only need the **dev** project. Prod can wait until you're ready to deploy to GitHub Pages.

---

## Phase 3 — Wire your Firebase configs into the app (3 min)

Open `js/firebase-init.js`. There are two config blocks — `PROD_CONFIG`
and `DEV_CONFIG`. Replace each with the matching snippet from Firebase.
For local-only testing today, you can leave `PROD_CONFIG` as
placeholders; just fill in `DEV_CONFIG`:

```js
const DEV_CONFIG = {
  apiKey: "AIza...",                              // dev project
  authDomain: "eric-tta-dev.firebaseapp.com",
  projectId: "eric-tta-dev",
  storageBucket: "eric-tta-dev.firebasestorage.app",
  messagingSenderId: "123456...",
  appId: "1:123:web:abc..."
};
```

The app picks dev when `location.hostname` is `localhost`, `127.0.0.1`,
or `0.0.0.0`. On any other host (GitHub Pages, custom domain) it picks
prod automatically. The "DEV" pill in the page corner is your visual
confirmation.

Open `.firebaserc`. If your dev project ID differs from `eric-tta-dev`,
update both `default` and `dev` entries to match:

```json
{
  "projects": {
    "default": "your-dev-project-id",
    "dev":     "your-dev-project-id",
    "prod":    "your-prod-project-id"
  }
}
```

---

## Phase 4 — Connect the CLI and deploy rules + indexes (2 min)

```bash
cd /Users/baodongliu/work/eric-tta
npx firebase login          # opens browser, sign in once
npm run deploy:rules:dev    # deploys firestore.rules + indexes to eric-tta-dev
```

Expected last line: `✔ Deploy complete!`

Indexes finish building in the background within ~2 minutes. Rules go
live immediately. Run `npm run deploy:rules:prod` when you're ready to
push the same to the prod project.

You can also `npx firebase use dev` (or `npx firebase use prod`) to set
the active project; subsequent `npx firebase deploy --only ...` (no
`--project`) targets it.

---

## Phase 5 — Run the app locally (30 sec)

```bash
npm run dev
```

Wraps `http-server` (the locally-installed one) on port 8765 with caching disabled. If port 8765 is busy, edit the `dev` script in `package.json`.

Open <http://localhost:8765> in Chrome (or Safari/Firefox). You see the
**Sign in** card with a yellow **DEV · eric-tta-dev** pill in the
bottom-left corner — that confirms the app picked the dev config.
(If the pill says a different project ID, your `js/firebase-init.js`
DEV_CONFIG isn't pointing where you think.)

Open DevTools → Console — keep it open during the smoke test to catch
any Firebase errors.

---

## Phase 6 — Bootstrap your admin account (2 min)

1. Click **Create an account**. Use a real email (so password-reset
   works later). Pick any password ≥ 6 chars.
2. After signup you land on the student dashboard with "None" / 0 hours.
   Expected.
3. Open another tab → Firebase console → **Firestore Database** → click
   the `users` collection → click your uid doc.
4. Edit `role` from `"student"` to `"admin"`. Save.
5. Back in the app tab, **Sign out** (top-right) and sign back in. You
   land on `/admin/index.html` — admin dashboard with KPI tiles and a
   green "Live" pill.

---

## Phase 7 — Live smoke test (10–15 min)

Open a second browser window in **private/incognito** mode alongside
your admin window — that one plays "student". Each step below assumes
you're switching between the two as labeled.

### A. Student-tier basics

1. **[student]** Register `alice@example.com`. Sign out, register
   `bob@example.com`. Each lands on a student dashboard showing
   None / 0.
2. **[admin]** Top nav → **Log purchase** → Alice, private, 10 hours,
   today. Save.
3. **[Alice]** Refresh. Dashboard shows `10 / 10 / 0` for private hours.
4. **[admin]** **Log lesson** → Alice, today, private, 1 hour, coach
   Eric. Save.
5. **[Alice]** Refresh. Private now `9 / 10 / 1`. **History** page lists
   the lesson row.
6. **[admin]** **Log membership** → owner type **student**, Alice, tier
   `Adult (annual)`, today, +1 year. Save.
7. **[Alice]** Refresh. Membership card shows the tier with ~365 days
   remaining.

### B. Family-tier — the critical rule path

8. **[admin]** Top nav → **Students**. In "Family groups", enter
   "Smith Family", click both Alice and Bob's chips, **Create family
   group**. Groups table shows the new family with both members.
9. **[admin]** Top nav → **Log membership** → owner type **family**.
   Dropdown should show "Smith Family". Pick it, tier `Family
   (annual)`, today, +1 year. Save.

   **⚠️ This is the most likely first-failure point.** If it errors
   with `permission-denied` or "Missing or insufficient permissions",
   the `getAfter` rule isn't behaving as expected. Stop and report —
   paste the DevTools console error verbatim.

   On success: a `memberships` doc with `ownerType: "family"` exists in
   Firestore.
10. **[Alice]** and **[Bob]** Refresh dashboards. Both show a
    Family-tier membership.

### C. Family lifecycle invariants

11. **[admin]** Students page → **Edit** on Bob → change family group
    to **— none —** → Save. **Expected error**: _"would leave 'Smith
    Family' with 1 valid member(s). Use the Dissolve action…"_ Cancel.
12. **[admin]** Click **Dissolve** on "Smith Family". **Expected
    error**: _"this family has 1 active membership(s) attached…"_
13. **[admin]** Firebase console → `memberships` → find the family doc
    from step 9, delete it manually.
14. **[admin]** Click **Dissolve** again. **Expected**: success toast,
    family disappears from table. Both students' dashboards now show no
    family membership.

### D. History visibility for former members

15. **[admin]** Re-create "Smith Family v2" with Alice + Bob. Log a
    fresh family membership against it.
16. **[admin]** Manually delete that membership doc in the Firebase
    console.
17. **[admin]** Dissolve "Smith Family v2".
18. **[Alice]** Click **History**. The family membership row from step
    15 should still appear (visible via `memberUidsAtCreation` even
    though Alice is no longer in any family).

### E. Offline behavior

19. **[admin]** DevTools → **Network** tab → check **Offline**. Header
    shows the yellow "Offline" banner.
20. **[admin]** **Log lesson** → Alice, 0.5 hours private, today.
    Submit. Should accept (queued).
21. **[admin]** **Students** → **Edit** Alice → change family group →
    Save. **Expected**: _"Family group changes need an online
    connection."_
22. **[admin]** DevTools uncheck Offline. Within ~1 second, the lesson
    from step 20 appears in Alice's history (auto-synced via the
    realtime listener).

### F. Delete + Edit affordance

23. **[admin]** Admin dashboard → **Recent activity** → **Delete** on
    any row → confirm-and-preview modal pops up → confirm. Row
    disappears; realtime listener auto-refreshes.
24. **[admin]** Same table → **Edit** on a lesson row → modal opens
    pre-filled with the current values. Change Coach from "Eric" to
    "Anna" → Save → diff-only confirm shows just `Coach: Eric → Anna`
    → confirm. Row updates in place.

### F2. Time-based lesson logging

25. **[admin]** **Log lesson** form → Start time and End time are
    `<select>` dropdowns with half-hour options (10 AM – 10 PM).
    Start defaults to ~now (rounded); end defaults to start + 1 h.
    Picking a different start updates end automatically and rebuilds
    the end dropdown to drop any time ≤ start. Hours is read-only.

### F3. Confirm previews

26. **[admin]** Submit any of the three log forms. A modal pops up
    with the exact field values you're about to commit (including
    the student's before/after balance for `Log lesson`). Cancel
    leaves the form open; Confirm proceeds with the write.

### G-pre. Google sign-in (only if you enabled it in Phase 2)

In a fresh incognito window, go to <http://localhost:8765> → click
**Continue with Google**. A popup opens, you pick a Google account,
the popup closes, and you land on the student dashboard with your
Google display name shown in the header. Confirm a `users/{uid}` doc
was auto-created in Firestore with `role: "student"` and your Gmail
address as `email`.

If you click Continue with Google a second time (after signing out),
the existing doc is reused — no duplicate is created. Try it as a
sanity check.

### G. Password reset

24. <http://localhost:8765/reset.html> → enter `alice@example.com` →
    **Send reset link**. Success message appears. Check Alice's inbox —
    Firebase emails the reset link. (If you used a fake address, this
    step is silently a no-op — by design, no email enumeration.)

### H. Unit tests

```bash
npm test
```

Expected: `pass 12, fail 0`. Wraps `node --test test/balance.test.js` (no test runner dep).

---

## Troubleshooting cheatsheet

| Symptom | Fix |
|---|---|
| Sign-in spinner forever; DevTools shows `auth/unauthorized-domain` | Firebase console → **Authentication → Settings → Authorized domains** → add `localhost`. |
| Step 9 → `permission-denied` | The `getAfter` rule. Quick workaround: edit `firestore.rules` line ~78–86 to `allow create: if isAdmin();`, run `firebase deploy --only firestore:rules`, retry. Tell me so I can patch it properly. |
| `The query requires an index. You can create it here: <link>` | Click the link, wait ~2 min for the index. (Shouldn't happen — Phase 4 deployed them.) |
| Imports 404'ing in console | You opened HTML via `file://`. ES modules require `http://`. Use the `python3 -m http.server` command, not Finder/Explorer. |
| `apiKey is invalid` or `app/no-app` | Phase 3 didn't take. Reopen `js/firebase-init.js` and confirm placeholders are replaced. Save, hard-refresh (Cmd-Shift-R). |
| Step 22 — lesson never appears | Confirm the "Live" pill on admin dashboard is green (not Offline). Hard-refresh. |
| Anything else 5xx-ing | Screenshot the DevTools console + the Firestore console state at that moment, and report. |

---

## When this is green

All sections A–H pass without a `permission-denied` or 5xx anywhere →
the local build is ship-ready. The remaining work is:

1. Push the repo to GitHub.
2. Settings → Pages → Source = main / root.
3. Add the GitHub Pages domain to Firebase Auth Authorized domains.

That's a separate ~5-minute step we'll do after the local test is
clean.
