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

### 1. Create a Firebase project

- Go to [console.firebase.google.com](https://console.firebase.google.com), create a project (e.g. `eric-tta`).
- **Authentication → Get started → Email/Password → Enable.**
- **Firestore Database → Create database → Production mode**, region `us-west1` (closest to Redmond).
- **Project settings → General → Your apps → Add web app** (no Hosting needed). Copy the config snippet.

### 2. Wire the config

Open `js/firebase-init.js` and replace the `firebaseConfig` object with the
config snippet from Firebase. (The `apiKey` is safe to commit — Firestore
security is enforced by rules, not by hiding the key.)

### 3. Deploy security rules

```bash
npm install -g firebase-tools     # one-time
firebase login
firebase use --add                # pick your project, alias it "default"
firebase deploy --only firestore:rules,firestore:indexes
```

Re-run this command whenever you change `firestore.rules`.

### 4. Bootstrap your admin account

1. Run the app locally (next section).
2. Open `http://localhost:8765/register.html` and register an account for yourself.
3. In the Firebase console, open Firestore → `users` → your doc → set `role` to `"admin"`.
4. Sign out and back in — you'll land on `admin/index.html`.

## Local development

Any static file server works. Easiest:

```bash
python3 -m http.server 8765
```

Open <http://localhost:8765>. Add `localhost` under
**Authentication → Settings → Authorized domains** in the Firebase console
(it usually is by default).

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
- Writes you make as admin queue locally and replay when the connection comes back.
- A yellow banner appears at the top of every page when offline.

## Troubleshooting

- **"Missing or insufficient permissions"** — usually means rules aren't deployed yet, or your `users/{uid}.role` isn't `"admin"`. Check the Firebase console.
- **Auth pop-up domain error** — you forgot to add the domain to Authorized domains.
- **Imports fail with 404** — confirm you're running through a server (not opening files directly). Modules require `http://` or `https://`.

## Out of scope (potential v2)

Lesson scheduling/booking, payment processing, expiry email reminders,
per-coach views, public marketing pages.
