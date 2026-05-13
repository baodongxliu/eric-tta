# Eric Table Tennis — Member App

Lightweight web app for the Eric Table Tennis Club. Students see their
membership status and lesson balance; admin (you) logs membership purchases,
bulk lesson packages, and lessons used. Static HTML/JS hosted on GitHub
Pages, backed by Firebase Firestore + Auth.

## What's in here

```
.
├── index.html              # Login
├── register.html           # Student signup
├── dashboard.html          # Student dashboard
├── history.html            # Student activity history
├── admin/                  # Admin pages (dashboard, students, log forms)
├── css/style.css           # Brand-matched styles
├── js/                     # ES-module app code
│   ├── firebase-init.js    # << EDIT THIS: paste your Firebase web config
│   ├── auth.js
│   ├── db.js
│   ├── balance.js
│   ├── ui.js
│   └── pages/*.js
├── firestore.rules         # Server-side authorization
├── firestore.indexes.json
├── firebase.json           # Firebase CLI config (rules + indexes only)
└── .firebaserc
```

There is no build step. Edit files and reload the browser.

## One-time setup

### 1. Create TWO Firebase projects (dev + prod)

The app keeps local-test data isolated from production by running against a separate dev Firebase project on `localhost`. Create both up front; the second one takes ~5 minutes because the steps are identical.

For each of `eric-tta-dev` and `eric-tta-prod`:

- Go to [console.firebase.google.com](https://console.firebase.google.com), create the project. Use distinct project IDs.
- **Authentication → Get started → Email/Password → Enable.**
- (Optional) **Authentication → Sign-in method → Google → Enable**, set a project support email, **Save**. Adds a "Continue with Google" button to the auth pages; first-time Google sign-in auto-creates `users/{uid}` with `role: "student"`.
- **Firestore Database → Create database → Production mode**, region `us-west1` (closest to Redmond).
- **Project settings → General → Your apps → Add web app** (no Hosting needed). Copy the config snippet — you'll paste both into `js/firebase-init.js`.

### 1.5. Install project tooling (one-time)

```bash
npm install
```

Installs `firebase-tools` and `http-server` into `./node_modules`. No global installs required. Then attach the CLI to your Google account:

```bash
npx firebase login
```

### 2. Wire BOTH configs

Open `js/firebase-init.js`. There are two blocks — `PROD_CONFIG` and `DEV_CONFIG`. Replace each with the matching snippet from Firebase. (The `apiKey` values are safe to commit — Firestore security is enforced by rules, not by hiding the key.)

The app picks dev when `location.hostname` is `localhost`, `127.0.0.1`, or `0.0.0.0`; otherwise prod. When dev is active, a yellow "DEV" pill anchors to the bottom-left of every page so you can't confuse environments at a glance.

### 3. Deploy security rules + indexes to BOTH projects

`.firebaserc` already has aliases (`dev`, `prod`) pointing at `eric-tta-dev` and `eric-tta-prod`. Adjust those if your project IDs differ.

```bash
npm run deploy:rules:dev
npm run deploy:rules:prod
```

Re-run both whenever `firestore.rules` or `firestore.indexes.json` change.

The npm scripts wrap `firebase deploy --only firestore:rules,firestore:indexes --project ...` so you don't have to remember the flags. You can also `npx firebase use dev|prod` to set the active project; subsequent `npx firebase deploy --only ...` (no `--project`) targets it.

### 4. Bootstrap your admin account (in EACH project)

Admin status is per-project. You'll bootstrap once in dev and once in prod.

1. Run the app locally (next section). The "DEV" pill confirms you're on the dev project.
2. Open `http://localhost:8765/register.html` and register an account.
3. In the **eric-tta-dev** Firebase console, Firestore → `users` → your doc → set `role` to `"admin"`. Sign out, sign back in.
4. After deploying to GitHub Pages (or any non-localhost URL), repeat steps 2-3 against the **eric-tta-prod** project. The DEV pill will be absent on prod.

## Local development

```bash
npm run dev
```

Wraps `http-server` (installed locally, no global setup) on port 8765 with caching disabled. Open <http://localhost:8765>. `localhost` is auto-allowed in **Authentication → Settings → Authorized domains** by default.

## Deploying to GitHub Pages

1. Push this folder to a GitHub repo (e.g. `eric-tta-app`).
2. **Settings → Pages → Source → Deploy from a branch**, pick `main` and `/ (root)`. Save.
3. Wait for the green checkmark, then open the published URL (e.g. `username.github.io/eric-tta-app`).
4. In Firebase: **Authentication → Settings → Authorized domains → Add domain** for the GitHub Pages domain (and any custom domain you set).

If you have a custom domain like `app.erictabletennis.com`, point it at
GitHub Pages with a `CNAME` record and add it to GitHub Pages settings; also
add it to Firebase authorized domains.

Rules and indexes still need to be deployed via the Firebase CLI — GitHub
Pages only hosts static files.

## Day-to-day use

### As admin (you)

- **Admin dashboard** — quick stats, who's expiring, who has low balances, today's lessons. Updates live via Firestore listeners; the green "Live" pill turns yellow when offline.
- **Log membership** — pick student or family, tier name, valid-from/until.
- **Log bulk lessons** — student, type (private/group), hours.
- **Log lesson used** — student, date, type, hours, coach name.
- **Students** — list with filters; manage family groups (link 2–4 student accounts under one Family membership).

### As student

- Sign up with email/password.
- See current membership tier, days remaining, and remaining private/group hours on the dashboard.
- View full history with date filters (From/To, "Today only").

## Data model (Firestore collections)

- `users/{uid}` — `{ email, displayName, role, familyGroupId, createdAt }`
- `familyGroups/{id}` — `{ name, memberUids[], createdAt }`
- `memberships/{id}` — `{ ownerType, ownerId, tier, validFrom, validUntil, purchaseDate, notes, createdBy, createdAt }`
- `lessonPurchases/{id}` — `{ studentId, type, hours, purchaseDate, notes, createdBy, createdAt }`
- `lessonsUsed/{id}` — `{ studentId, date, type, hours, coachName, notes, createdBy, createdAt }`

All writes that affect balance/membership are admin-only. Students can only
read their own data (and family-group memberships if they belong to one).

## Offline support

Firestore's persistent local cache is enabled. The app keeps working when
the device is offline:

- Reads serve last-known data.
- Most admin writes (student-owned membership purchases, bulk lesson packages, lessons used, profile-only edits) queue locally and replay when the connection comes back.
- Anything that touches the family-group invariant needs a live connection: family-group create, edit (transfer), **dissolve**, and family-tier (`ownerType: "family"`) membership purchases. These use Firestore transactions for cross-document atomicity and don't queue offline; the form refuses to submit and shows a toast/inline error.
- Use the **Dissolve** button on the Students page to break up a family. It refuses while any *active* family-tier membership is still attached (`validUntil >= today`); expired ones are kept as history and don't block. Resolve any active ones first (refund or move to an individual record).
- Past family-tier memberships stay visible to former members. Each family-membership doc snapshots `memberUidsAtCreation` at write time, and queries/rules use `array-contains` on that field, so leaving the family (or dissolving it) preserves the audit/history trail without granting ongoing entitlement.
- A yellow banner appears at the top of every page when offline.

## Pre-launch smoke test

Run through this once on a fresh Firebase project (the Local Emulator works too) before letting any real student touch the app. Ten minutes; catches the deployment-time issues that don't show up in `node --check`.

Setup
1. `firebase deploy --only firestore:rules,firestore:indexes` — deploy both. The `memberships` composite index on `(ownerType, memberUidsAtCreation)` is required for the student dashboard's family-history query.
2. Serve the app: `python3 -m http.server 8765` from the repo root.
3. Open <http://localhost:8765/register.html>, register `eric@example.com`. In the Firebase console, flip that user's `users/{uid}.role` to `"admin"` and `displayName` to your real name. Sign out, sign in.

Critical paths
4. Register two more accounts (`a@x.com`, `b@x.com`). They land on the student dashboard showing "None" for membership.
5. As admin, go to **Log bulk lessons** → log 10 private hours for student A. Switch to A's tab, refresh — dashboard shows 10/10/0.
6. **Log lesson used** → 1 hour for A with coach Eric. A's dashboard shows 10/9/1; the entry shows up in History.
7. **Log membership** → Adult, validFrom today, validUntil +1 year, owner = A (student). A's dashboard shows the tier with N days remaining.
8. **Family-tier path (this is the one most likely to fail at the rule layer):**
   - On the Students page, create a family group "Test" with A and B.
   - On Log membership, switch owner type to "family", pick "Test", tier = "Family", save. **If this returns `permission-denied`, the `getAfter` rule isn't behaving — re-check `firestore.rules` and the deployed version.**
   - Both A and B's dashboards show the family membership.
9. Move B out of "Test" via the student edit modal — should fail with "would leave …with fewer than 2 members. Use the Dissolve action".
10. Click **Dissolve** on the family — should fail with "active membership(s) attached".
11. In Firestore console, delete that family membership doc by hand. Click Dissolve again — succeeds. Both A and B revert to no family.
12. **Offline check**: in the admin tab, open DevTools → Network → Offline. Try Log lesson used (should succeed and queue). Try Family-group edit (should refuse with the inline error). Re-enable network — the queued lesson appears.
13. **History visibility**: log a fresh family membership against a new test family. Move one member out. Confirm the moved member's history page still shows the membership (via `memberUidsAtCreation`).
14. **Delete affordance**: on the admin dashboard's recent activity, click Delete on any logged record. Confirm it disappears.
15. **Password reset**: open `/reset.html`, enter the registered email, confirm the reset email arrives.

Expected red flags during this run
- Step 8 → `permission-denied`: `getAfter` semantics issue. Inspect the `/memberships/{id}` create rule.
- Step 4/5 querying memberships → "the query requires an index" error with a one-click link: click it. Should be pre-deployed via step 1; if missing, deploy `firestore.indexes.json`.
- Anything else 500-ing: check browser console + `firebase functions:log` (none used yet, but a good habit).

## Run unit tests

`balance.js` is pure logic and has unit tests:

```bash
npm test
```

12 tests, runs against built-in `node --test` (no test runner dependency). Run before any change to membership status / hour computation.

## Troubleshooting

- **"Missing or insufficient permissions"** — usually means rules aren't deployed yet, or your `users/{uid}.role` isn't `"admin"`. Check the Firebase console.
- **Auth pop-up domain error** — you forgot to add the domain to Authorized domains.
- **Imports fail with 404** — confirm you're running through a server (not opening files directly). Modules require `http://` or `https://`.

## Out of scope (potential v2)

Lesson scheduling/booking, payment processing, expiry email reminders,
per-coach views, public marketing pages.
