# Production deploy walkthrough

Push the app to a live URL that anyone with internet access can use, with
near-realtime sync across phone / tablet / laptop. ~15–20 minutes total.

Prerequisites:

- Local smoke test (`test.md`) ran cleanly against `eric-tta` (the dev project).
- `js/firebase-init.js` has BOTH `PROD_CONFIG` and `DEV_CONFIG` filled in.
- `.firebaserc` has `dev` and `prod` aliases pointing at the right project IDs.
- A GitHub account.

---

## Phase 1 — Configure the prod Firebase project (~3 min, browser)

Open <https://console.firebase.google.com> → click **eric-tta-prod**.
Mirror what you did on dev:

1. **Build → Authentication → Get started → Email/Password → Enable → Save.**
2. (Optional) **Authentication → Sign-in method → Add new provider →
   Google → Enable**, set a project support email, **Save**.
3. **Build → Firestore Database → Create database → Production mode →
   Region us-west1 → Enable.**

Don't bootstrap admin yet — that comes after Phase 4 once you know the
live URL.

---

## Phase 2 — Deploy rules + indexes to prod

```bash
cd /Users/baodongliu/work/eric-tta
npm run deploy:rules:prod
```

Pushes the same `firestore.rules` and `firestore.indexes.json` to
`eric-tta-prod` that are live on dev. Composite indexes finish building
in the background within ~2 minutes; rules go live immediately.

Re-run this whenever you change either file.

---

## Phase 3 — Commit and push to GitHub (~5 min)

The repo has been local-only. Time to push everything.

1. Create a new repository on GitHub:
   - <https://github.com/new>.
   - Name: `eric-tta` (or whatever).
   - **Public** (required for free GitHub Pages; private needs a paid
     plan). The Firebase API keys in `firebase-init.js` are safe to be
     public — security is enforced by Firestore rules, not by hiding the
     key.
   - Don't add a README/license/`.gitignore` — we already have them.
   - **Create repository**.

2. From your terminal:

   ```bash
   cd /Users/baodongliu/work/eric-tta
   git add -A
   git commit -m "Dev/prod environments, password reset, Google SSO, delete affordance, test suite"
   git branch -M main
   git remote add origin git@github.com:YOUR_USERNAME/eric-tta.git
   git push -u origin main
   ```

   Replace `YOUR_USERNAME` with your GitHub username. Use the HTTPS URL
   (`https://github.com/.../eric-tta.git`) if you don't have SSH keys
   set up.

   If you have the `gh` CLI installed, the whole repo-create + push is:

   ```bash
   cd /Users/baodongliu/work/eric-tta
   git add -A && git commit -m "Production-ready"
   gh repo create eric-tta --public --source=. --remote=origin --push
   ```

---

## Phase 4 — Enable GitHub Pages (~2 min, browser)

In the GitHub repo's web UI:

1. **Settings → Pages**.
2. **Source**: Deploy from a branch.
3. **Branch**: `main`, folder: `/ (root)`.
4. **Save**.
5. Wait ~30–60 seconds. The same page then shows your live URL:
   `https://YOUR_USERNAME.github.io/eric-tta/`.

Open it. The yellow **DEV** pill should be **absent** — that confirms
the app autopicked `PROD_CONFIG` because the hostname isn't `localhost`.

---

## Phase 5 — Authorize the live domain in prod Firebase (~1 min, browser)

Without this, sign-in fails on the live site with `auth/unauthorized-domain`.

Firebase console (**eric-tta-prod**) → **Authentication → Settings →
Authorized domains → Add domain** → paste `YOUR_USERNAME.github.io`.
Save.

(If you add a custom domain like `app.erictabletennis.com` later, also
add it here.)

---

## Phase 6 — Bootstrap admin on prod (~3 min, browser)

Same dance as on dev, but in the prod project.

1. On the live URL `https://YOUR_USERNAME.github.io/eric-tta/`, click
   **Create an account**. Register with your real email.
2. You land on the student dashboard (None / 0 hours).
3. Firebase console → **eric-tta-prod** → Firestore → `users` → click
   your doc → set `role` to `"admin"`. Save.
4. Sign out, sign back in. You land on `/admin/index.html` on the live
   URL.

---

## Phase 7 — Verify cross-device sync (~3 min)

What "everyone gets the latest" actually means in this app:

| Surface | Sync behavior |
|---|---|
| **Admin dashboard** | Realtime — uses Firestore `onSnapshot` listeners on five collections. New lessons / memberships / family changes appear within ~1 second across all open admin tabs (laptop + phone). |
| **Student dashboard / history** | Fetched once on page load. Refresh to see updates. |
| **Writes from any device** | Hit Firestore directly, propagate within ~1 second to every connected listener. Offline writes (most admin writes except family-group changes) queue locally and replay on reconnect. |

Quick cross-device test:

1. Laptop: open the live URL → sign in as admin.
2. Phone: open the same URL → register as a test student
   (`teststudent@example.com`).
3. Laptop: **Log lesson used** for that test student.
4. Phone: refresh the test student's dashboard. The lesson balance
   reflects the new entry within a second.

---

## Phase 8 — Share with users

Send them the live URL. New students click **Create an account** (or
**Continue with Google**), bookmark the page, and they're set. Add the
link to your bookmarks bar on laptop + home-screen on phone (most
browsers: Share → Add to Home Screen).

---

## Re-deploying changes later

1. **Code changes**: commit and `git push`. GitHub Pages republishes
   within ~30–60 seconds; users get the new build on next reload.
2. **Rules or indexes**: run `npm run deploy:rules:prod` (and
   `npm run deploy:rules:dev` if you want dev to match).
3. **Auth provider changes**: Firebase console only; no deploy needed.

## Rolling back

GitHub Pages serves whatever's on `main`. To roll back a bad deploy:

```bash
git revert HEAD          # creates a new commit that undoes the last
git push
```

Rules can be rolled back in the Firebase console: **Firestore → Rules
→ History**, pick a previous version, **Publish**.

## Custom domain (later, optional)

Want `app.erictabletennis.com` instead of the github.io URL?

1. In the GitHub repo: **Settings → Pages → Custom domain** → enter
   `app.erictabletennis.com`. Enable HTTPS.
2. In your DNS provider (whoever runs `erictabletennis.com`):
   - Add a `CNAME` record for `app` pointing at `YOUR_USERNAME.github.io`.
3. Wait for DNS to propagate (~10 minutes to a few hours).
4. Firebase console (**eric-tta-prod**) → Authentication → Settings →
   Authorized domains → add `app.erictabletennis.com`.
