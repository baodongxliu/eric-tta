# CLAUDE.md

Eric Table Tennis Club member portal. Static HTML/JS, Firebase Firestore + Auth, deployed to GitHub Pages.

This file is loaded automatically by Claude Code at session start. For deeper context — decision history, known gaps, production-schema plans — see `.claude/skills/handoff/SKILL.md` (gitignored, local-only).

## Tech facts that aren't obvious from the code

- **No build step.** ES modules from gstatic CDN, Firebase Web SDK 10.12.5.
- **Multi-page app.** One HTML per route under `admin/` and the root. Each imports its own page module under `js/pages/`.
- **Realtime listeners** on the admin dashboard (`onSnapshot`). Other pages do one-shot fetches.
- **Offline support** via Firestore `persistentLocalCache` + `persistentMultipleTabManager`. Most admin writes queue offline; family-group txns and family-tier membership writes require online (they use `runTransaction`).
- **Project tooling via npm** — `firebase-tools` and `http-server` install into `./node_modules`. No global installs.
- **Node 22 LTS** pinned in `.nvmrc`.

## Two Firebase environments

`js/firebase-init.js` carries BOTH a `PROD_CONFIG` and a `DEV_CONFIG` and autopicks based on `location.hostname`:

- `localhost` / `127.0.0.1` / `0.0.0.0` → `DEV_CONFIG` (project `eric-tta`).
- Anywhere else (GitHub Pages, custom domain) → `PROD_CONFIG` (project `eric-tta-prod`).

A yellow **DEV · {projectId}** pill anchors to the bottom-left of every page when the dev config is active.

`.firebaserc` defines `dev` and `prod` aliases. Deploy rules + indexes with:

```bash
npm run deploy:rules:dev
npm run deploy:rules:prod
```

Admin role is per-environment — bootstrap once in each Firebase Firestore console by flipping `users/{uid}.role` to `"admin"`.

## File layout

```
index.html, register.html, reset.html   Auth pages (login, signup, password reset)
dashboard.html, history.html            Student pages
admin/*.html                            Admin: dashboard, students, three log forms
css/style.css                           Brand-matched styles (dark nav, white cards, red accent)
js/firebase-init.js                     PROD + DEV configs, autopick on hostname, DEV pill
js/auth.js                              signIn, signUp, signInWithGoogle, requestPasswordReset, requireAuth/Student/Admin
js/db.js                                Firestore CRUD + atomic family-group txns + delete/update helpers
js/balance.js                           Pure compute: membership status, hours, timeline, date filters
js/ui.js                                renderHeader, formatters, toast, el(), populateStudentTypeahead, confirmAction
js/pages/*.js                           Per-page scripts (one per HTML)
firestore.rules                         Security rules (deploy via firebase CLI)
firestore.indexes.json                  Composite indexes for the array-contains query
test/balance.test.js                    12 unit tests via `node --test test/balance.test.js`
README.md                               User-facing setup
test.md                                 Local smoke-test walkthrough
deploy.md                               Production deploy walkthrough
.claude/skills/handoff/SKILL.md         Detailed handoff for Claude (gitignored)
.claude/skills/handoff/PRODUCTION_SCHEMA.md   v2 schema design (gitignored)
```

## Data model (5 Firestore collections)

- `users/{uid}` — `{ email, displayName, role: "student"|"admin", familyGroupId, createdAt }`.
- `familyGroups/{id}` — `{ name, memberUids[], familyMembershipCount, createdAt }`. The count field is a monotonic contention point so `dissolve` detects a concurrent membership attach.
- `memberships/{id}` — `{ ownerType: "student"|"family", ownerId, tier, validFrom, validUntil, purchaseDate, notes, createdBy, createdAt, memberUidsAtCreation? }`. Family-tier docs carry an immutable roster snapshot so former members keep history visibility.
- `lessonPurchases/{id}` — bulk-hour package: `{ studentId, type, hours, purchaseDate, notes, createdBy, createdAt }`.
- `lessonsUsed/{id}` — completed lesson event: `{ studentId, date, type, hours, coachName, notes, createdBy, createdAt }`.

Money isn't tracked. Tier and coach names are free-text strings. A v2 schema is fully designed but not built — see `.claude/skills/handoff/PRODUCTION_SCHEMA.md`.

## Atomic invariants (the family-group story)

The family-group lifecycle is the most subtle code in the app. All cross-doc mutations are atomic via `runTransaction`:

- **`commitFamilyGroupCreate`** — creates the group + repoints user `familyGroupId` atomically. Validates back-ref counts on source groups so legacy `memberUids` drift can't slip through.
- **`commitFamilyGroupTransfer`** — single-student move. Reads the user's CURRENT `familyGroupId` inside the tx and bails if it doesn't match a stale dialog snapshot (`expectedFromGroupId`). Validates 2–4 invariant on both target and source via actual user back-refs.
- **`commitFamilyGroupDissolve`** — preflight queries memberships (active = `validUntil >= today`) and refuses if any. Snapshots `familyMembershipCount` and verifies it inside the tx. Backfills `memberUidsAtCreation` on any legacy memberships before deleting.
- **`logMembership` (family branch)** — validates 2–4 invariant + bidirectional back-refs + bumps `familyMembershipCount` so dissolve detects concurrent attaches.

`firestore.rules` enforce the count-bump contract server-side via `getAfter()`, so client-side cooperation isn't required.

**Do not "simplify" this code without an explicit user ask.** It earned its complexity through multiple rounds of adversarial review — see SKILL.md for the history.

## Admin UX conventions

- **Searchable student picker** in all three log forms. Custom popup combobox in `ui.js::populateStudentTypeahead` — substring match on name OR email, keyboard nav, click-to-pick.
- **Confirm-with-preview** before every admin CUD write via `ui.js::confirmAction({title, rows, confirmLabel, variant})`. Preview renders a key/value table; `variant: "danger"` colors the confirm button red for delete/dissolve.
- **Edit affordance** on the admin dashboard's Today's-lessons and Recent-activity tables. Kind-specific modal pre-filled with current values. Identity fields (studentId / ownerType / ownerId) are not editable — those mistakes stay delete-and-relog.
- **Time-based lesson logging** — start + end pickers (10:00 AM – 9:30 PM start, 10:30 AM – 10:00 PM end, club-hours range). Half-hour increments only. Hours auto-derived. End auto-defaults to start + 1 h, and the end-time list filters to slots strictly later than the chosen start. Default start = current local time rounded to nearest half-hour.
- **Balance preview** in the lesson-log confirm — shows "Private balance now: X h / After this lesson: Y h" with a "over balance!" suffix if Y < 0.

## Style preferences observed (matter for collaboration)

- **Concise responses.** No trailing summaries; don't recap what just happened.
- **Surgical edits.** Don't refactor adjacent code unless asked.
- **No emojis** unless asked.
- **Production-ready bar.** Push back on shortcuts; the user dislikes "good enough for a demo" framing.
- **Plan mode** for any non-trivial design work — wait for approval before coding.
- **Always run `node --check` on edited modules and `npm test` after touching `balance.js`** before reporting done.
- **`git push` to deploy code** (GitHub Pages republishes ~60 s). `npm run deploy:rules:prod` only needed when `firestore.rules` or `firestore.indexes.json` change.

## Where to start when resuming

1. Read this file.
2. Skim `.claude/skills/handoff/SKILL.md` for the deeper context (Codex review history, known gaps, confidence score, v2 schema pointer).
3. `git log --oneline -20` to see what's been changing.
4. Local dev:
   ```bash
   npm run dev          # serves on :8765 via http-server
   npm test             # 12 unit tests on balance.js
   npm run deploy:rules:dev   # push rules + indexes to eric-tta
   npm run deploy:rules:prod  # push rules + indexes to eric-tta-prod
   ```
5. After UI/JS edits: `node --check` on every edited module before saying "done."

## Pointers

- **User-facing setup** → `README.md`
- **Local smoke test** → `test.md`
- **Production deploy** → `deploy.md`
- **Detailed handoff (gitignored)** → `.claude/skills/handoff/SKILL.md`
- **v2 schema design (gitignored)** → `.claude/skills/handoff/PRODUCTION_SCHEMA.md`
