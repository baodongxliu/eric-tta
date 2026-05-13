import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
  onSnapshot,
  runTransaction,
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "./firebase-init.js";

// ─── Users ─────────────────────────────────────────────────────────────
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

export async function listAllStudents() {
  const q = query(collection(db, "users"), where("role", "==", "student"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

// Profile-only edit: no cross-doc invariant, no transaction needed. Uses
// plain updateDoc so it queues correctly when admin is offline.
export async function commitStudentDisplayName({ uid, displayName }) {
  await updateDoc(doc(db, "users", uid), { displayName });
}

// ─── Family groups ─────────────────────────────────────────────────────
export async function getFamilyGroup(groupId) {
  if (!groupId) return null;
  const snap = await getDoc(doc(db, "familyGroups", groupId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listFamilyGroups() {
  const snap = await getDocs(collection(db, "familyGroups"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Atomic family-group create.
//
// A runTransaction (rather than writeBatch) so we read each picked user's
// CURRENT familyGroupId at commit time, not the dialog-open snapshot — that
// way a concurrent transfer that landed between dialog open and submit is
// observed and Firestore retries us against fresh state, preventing
// split-brain "student in two groups" outcomes.
//
// memberUids edits use server-side arrayUnion/arrayRemove so concurrent
// writes to the same group compose. A dangling familyGroupId that points at
// a deleted group is tolerated: we read each affected old group inside the
// transaction and skip the removal if it no longer exists, so the user
// record can still be repaired.
export async function commitFamilyGroupCreate({ name, picked }) {
  if (picked.length < 2 || picked.length > 4) {
    throw new Error("Family groups must have 2 to 4 members.");
  }
  return runTransaction(db, async (tx) => {
    const userRefs = picked.map((uid) => doc(db, "users", uid));
    const userSnaps = await Promise.all(userRefs.map((ref) => tx.get(ref)));
    for (let i = 0; i < userSnaps.length; i++) {
      if (!userSnaps[i].exists()) {
        throw new Error(`Student ${picked[i]} not found.`);
      }
    }

    const removalsByGroup = new Map();
    for (let i = 0; i < picked.length; i++) {
      const oldId = userSnaps[i].data().familyGroupId;
      if (!oldId) continue;
      if (!removalsByGroup.has(oldId)) removalsByGroup.set(oldId, []);
      removalsByGroup.get(oldId).push(picked[i]);
    }

    const oldGroupIds = [...removalsByGroup.keys()];
    const oldGroupSnaps = await Promise.all(
      oldGroupIds.map((id) => tx.get(doc(db, "familyGroups", id)))
    );

    // To enforce the 2–4 invariant on each source group via actual user
    // back-refs (not just memberUids length, which can drift), read every
    // outsider — members of the source groups who aren't in `picked`.
    const outsiderUids = new Set();
    for (const snap of oldGroupSnaps) {
      if (!snap.exists()) continue;
      for (const u of snap.data().memberUids || []) {
        if (!picked.includes(u)) outsiderUids.add(u);
      }
    }
    const outsiderArr = [...outsiderUids];
    const outsiderSnaps = await Promise.all(
      outsiderArr.map((u) => tx.get(doc(db, "users", u)))
    );
    const userByUid = new Map();
    for (let i = 0; i < picked.length; i++) userByUid.set(picked[i], userSnaps[i]);
    for (let i = 0; i < outsiderArr.length; i++) userByUid.set(outsiderArr[i], outsiderSnaps[i]);

    // Source-side invariant: each source group's back-ref-counted remaining
    // (excluding leavers) must be ≥ 2. Empty / 1-leftover both rejected;
    // admin must Dissolve the source family explicitly.
    for (const snap of oldGroupSnaps) {
      if (!snap.exists()) continue;
      const groupId = snap.id;
      const leaving = removalsByGroup.get(groupId) || [];
      const oldMembers = snap.data().memberUids || [];
      let remaining = 0;
      for (const u of oldMembers) {
        if (leaving.includes(u)) continue;
        const us = userByUid.get(u);
        if (us?.exists() && us.data().familyGroupId === groupId) {
          remaining++;
        }
      }
      if (remaining < 2) {
        throw new Error(
          `Cannot create this family: source group "${snap.data().name || groupId}" would have ${remaining} valid member(s) back-ref-attached. Include them in the new family or use Dissolve on "${snap.data().name || groupId}" first.`
        );
      }
    }

    const existingOldGroupIds = new Set(
      oldGroupSnaps.filter((s) => s.exists()).map((s) => s.id)
    );
    for (const [groupId, uids] of removalsByGroup) {
      if (!existingOldGroupIds.has(groupId)) continue;
      tx.update(doc(db, "familyGroups", groupId), {
        memberUids: arrayRemove(...uids),
      });
    }

    const newRef = doc(collection(db, "familyGroups"));
    tx.set(newRef, {
      name,
      memberUids: picked,
      familyMembershipCount: 0,
      createdAt: serverTimestamp(),
    });

    for (const ref of userRefs) {
      tx.update(ref, { familyGroupId: newRef.id });
    }

    return newRef.id;
  });
}

// Atomic family-group dissolve.
//
// Refuses to run if any family-tier membership references the group.
// Concurrency guarantees:
//   - Membership-creation race: logMembership increments
//     `familyMembershipCount` inside its tx. We snapshot that count in the
//     preflight, then verify it inside our tx — any membership attached
//     between preflight and commit changes the count and aborts dissolve.
//   - Membership-edit race: commitFamilyGroupTransfer / Create write the
//     group's memberUids; that contention forces our tx to retry against
//     fresh state.
//
// Bidirectional consistency: we don't trust `memberUids` alone. We pre-
// query users where `familyGroupId == groupId` (the canonical backref),
// union with `memberUids` for defense, and inside the tx clear
// `familyGroupId` only on users whose CURRENT value matches the group
// being dissolved. Drifted entries (uid in array but pointing elsewhere)
// are left alone so we don't overwrite an unrelated assignment.
//
// Pre-flight queries can't run inside a Firestore web-SDK transaction, so
// a brand-new user who points at this group between preflight and commit
// could in theory escape the cleanup. In practice the only writers of
// `users.familyGroupId` are commitFamilyGroup{Create,Transfer}, which
// also write the group doc — those contend with us via Firestore's
// optimistic-concurrency on the group. Direct console writes are out of
// scope.
export async function commitFamilyGroupDissolve(familyGroupId) {
  const groupRef = doc(db, "familyGroups", familyGroupId);

  const [memSnap, groupPreSnap, userQuerySnap] = await Promise.all([
    getDocs(
      query(
        collection(db, "memberships"),
        where("ownerType", "==", "family"),
        where("ownerId", "==", familyGroupId)
      )
    ),
    getDoc(groupRef),
    getDocs(
      query(collection(db, "users"), where("familyGroupId", "==", familyGroupId))
    ),
  ]);

  // Only ACTIVE memberships block dissolve. Expired ones stay as history;
  // the field-level audit log of past Family tiers is still readable.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const activeMemberships = memSnap.docs.filter((d) => {
    const validUntil = d.data().validUntil;
    if (!validUntil) return true; // missing validUntil → treat as active (safer)
    const vu = validUntil.toDate ? validUntil.toDate() : new Date(validUntil);
    return vu >= todayStart;
  });
  if (activeMemberships.length > 0) {
    throw new Error(
      `Cannot dissolve: this family has ${activeMemberships.length} active membership(s) attached. Resolve those first (refund or move to an individual record) before dissolving. Expired memberships are kept as history and don't block dissolve.`
    );
  }
  if (!groupPreSnap.exists()) {
    throw new Error("Family group not found.");
  }
  const expectedCount = groupPreSnap.data().familyMembershipCount || 0;
  const userQueryUids = userQuerySnap.docs.map((d) => d.id);

  await runTransaction(db, async (tx) => {
    const groupSnap = await tx.get(groupRef);
    if (!groupSnap.exists()) {
      throw new Error("Family group not found.");
    }
    const data = groupSnap.data();
    if ((data.familyMembershipCount || 0) !== expectedCount) {
      throw new Error(
        "A family membership was attached just now. Refresh and try again."
      );
    }

    const arrayUids = data.memberUids || [];
    const candidateUids = [...new Set([...userQueryUids, ...arrayUids])];

    const memberRefs = candidateUids.map((uid) => doc(db, "users", uid));
    const memberSnaps = await Promise.all(
      memberRefs.map((ref) => tx.get(ref))
    );

    // Backfill memberUidsAtCreation on legacy memberships before the group
    // is gone — otherwise former members can't see those expired records
    // (rules + queries require either current backref or the snapshot).
    // Best-effort proxy: use the group's current memberUids as the roster.
    for (const memDoc of memSnap.docs) {
      if (memDoc.data().memberUidsAtCreation) continue;
      tx.update(doc(db, "memberships", memDoc.id), {
        memberUidsAtCreation: [...arrayUids],
      });
    }

    for (let i = 0; i < memberSnaps.length; i++) {
      if (!memberSnaps[i].exists()) continue;
      if (memberSnaps[i].data().familyGroupId !== familyGroupId) continue;
      tx.update(memberRefs[i], { familyGroupId: null });
    }

    tx.delete(groupRef);
  });
}

// Atomic family-group transfer for a single student. Caller must pass
// `expectedFromGroupId` — the familyGroupId they observed when the dialog
// opened. The transaction reads the user's CURRENT familyGroupId and bails
// if it differs, which prevents two concurrent dialogs from silently
// reverting each other's transfers. (Profile-only edits should call
// commitStudentDisplayName instead.)
export async function commitFamilyGroupTransfer({
  uid,
  displayName,
  toGroupId,
  expectedFromGroupId,
}) {
  await runTransaction(db, async (tx) => {
    const userRef = doc(db, "users", uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) {
      throw new Error("Student not found.");
    }

    const currentFromGroupId = userSnap.data().familyGroupId ?? null;
    if (currentFromGroupId !== expectedFromGroupId) {
      throw new Error(
        "This student's family changed since you opened this form. Refresh and try again."
      );
    }
    const groupChanged = currentFromGroupId !== toGroupId;

    let oldGroupSnap = null;
    if (groupChanged && currentFromGroupId) {
      oldGroupSnap = await tx.get(doc(db, "familyGroups", currentFromGroupId));
    }

    let newGroupSnap = null;
    if (groupChanged && toGroupId) {
      newGroupSnap = await tx.get(doc(db, "familyGroups", toGroupId));
      if (!newGroupSnap.exists()) {
        throw new Error("Selected family group no longer exists.");
      }
    }

    // Read every listed member of the source AND target group so the 2–4
    // invariant can be enforced against actual user back-refs, not the
    // potentially-drifted memberUids array. (Drift can exist from legacy
    // pre-atomic writes — counting array length alone could let a transfer
    // empty a group whose array still lists ghosts.)
    const otherUids = new Set();
    if (oldGroupSnap?.exists()) {
      for (const u of oldGroupSnap.data().memberUids || []) {
        if (u !== uid) otherUids.add(u);
      }
    }
    if (newGroupSnap?.exists()) {
      for (const u of newGroupSnap.data().memberUids || []) {
        if (u !== uid) otherUids.add(u);
      }
    }
    const otherArr = [...otherUids];
    const otherSnaps = await Promise.all(
      otherArr.map((u) => tx.get(doc(db, "users", u)))
    );
    const userByUid = new Map([[uid, userSnap]]);
    for (let i = 0; i < otherArr.length; i++) {
      userByUid.set(otherArr[i], otherSnaps[i]);
    }

    // Target side: post-transfer back-ref count must be in [2, 4].
    if (newGroupSnap?.exists()) {
      const targetMembers = newGroupSnap.data().memberUids || [];
      let validBackrefs = 0;
      let alreadyValid = false;
      for (const u of targetMembers) {
        const us = userByUid.get(u);
        if (us?.exists() && us.data().familyGroupId === toGroupId) {
          validBackrefs++;
          if (u === uid) alreadyValid = true;
        }
      }
      const postSize = validBackrefs + (alreadyValid ? 0 : 1);
      if (postSize > 4) {
        throw new Error(
          `"${newGroupSnap.data().name || newGroupSnap.id}" already has 4 members (the maximum).`
        );
      }
      if (postSize < 2) {
        throw new Error(
          `"${newGroupSnap.data().name || newGroupSnap.id}" doesn't have enough valid members for a family (back-ref count would be ${postSize}). Repair the group or use Dissolve.`
        );
      }
    }

    // Source side: post-removal back-ref count must be ≥ 2.
    if (groupChanged && oldGroupSnap?.exists()) {
      const oldMembers = oldGroupSnap.data().memberUids || [];
      let validBackrefs = 0;
      let leavingIsValid = false;
      for (const u of oldMembers) {
        const us = userByUid.get(u);
        if (us?.exists() && us.data().familyGroupId === currentFromGroupId) {
          validBackrefs++;
          if (u === uid) leavingIsValid = true;
        }
      }
      const oldRemaining = validBackrefs - (leavingIsValid ? 1 : 0);
      if (oldRemaining < 2) {
        throw new Error(
          `Removing this student would leave "${oldGroupSnap.data().name || oldGroupSnap.id}" with ${oldRemaining} valid member(s). Use the Dissolve action on that family instead.`
        );
      }
    }

    tx.update(userRef, {
      displayName,
      familyGroupId: toGroupId ?? null,
    });

    if (groupChanged && currentFromGroupId && oldGroupSnap?.exists()) {
      tx.update(doc(db, "familyGroups", currentFromGroupId), {
        memberUids: arrayRemove(uid),
      });
    }

    if (groupChanged && toGroupId) {
      tx.update(doc(db, "familyGroups", toGroupId), {
        memberUids: arrayUnion(uid),
      });
    }
  });
}

// ─── Memberships ───────────────────────────────────────────────────────
//
// Family memberships need TWO queries unioned (and deduped):
//   1. Current backref: ownerId == currentFamilyGroupId. Catches members
//      who joined the family AFTER the membership was logged, and any
//      legacy memberships predating the `memberUidsAtCreation` snapshot.
//   2. Historical snapshot: memberUidsAtCreation array-contains uid.
//      Catches former members who can no longer be found by current
//      backref (the family was dissolved, or they moved out).
// Whether a family membership counts toward the student's CURRENT
// entitlement is a consumer-side decision (filter by current familyGroupId).
export async function listMembershipsForStudent(uid, currentFamilyGroupId = null) {
  const dedup = new Map();
  const ingest = (snap) => {
    snap.docs.forEach((d) => dedup.set(d.id, { id: d.id, ...d.data() }));
  };

  const queries = [
    getDocs(
      query(
        collection(db, "memberships"),
        where("ownerType", "==", "student"),
        where("ownerId", "==", uid)
      )
    ),
    getDocs(
      query(
        collection(db, "memberships"),
        where("ownerType", "==", "family"),
        where("memberUidsAtCreation", "array-contains", uid)
      )
    ),
  ];
  if (currentFamilyGroupId) {
    queries.push(
      getDocs(
        query(
          collection(db, "memberships"),
          where("ownerType", "==", "family"),
          where("ownerId", "==", currentFamilyGroupId)
        )
      )
    );
  }

  const snaps = await Promise.all(queries);
  for (const snap of snaps) ingest(snap);
  return [...dedup.values()];
}

export async function listAllMemberships() {
  const snap = await getDocs(
    query(collection(db, "memberships"), orderBy("validUntil", "desc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function buildMembershipDoc({
  ownerType,
  ownerId,
  tier,
  validFrom,
  validUntil,
  purchaseDate,
  notes,
  createdBy,
}) {
  return {
    ownerType,
    ownerId,
    tier,
    validFrom: Timestamp.fromDate(validFrom),
    validUntil: Timestamp.fromDate(validUntil),
    purchaseDate: Timestamp.fromDate(purchaseDate),
    notes: notes || "",
    createdBy,
    createdAt: serverTimestamp(),
  };
}

// Family memberships need atomic validation against the bidirectional
// truth — the listed memberUids must each have a user doc whose
// `familyGroupId` actually points back at this group (memberUids alone is
// denormalized state and can drift). The transaction also bumps
// `familyMembershipCount` on the group, which is the contention point
// commitFamilyGroupDissolve uses to detect a concurrent attach.
//
// Student-owned memberships have no cross-doc invariant and use plain
// addDoc, which keeps them queueable offline.
export async function logMembership(input) {
  if (input.ownerType === "family") {
    return runTransaction(db, async (tx) => {
      const groupRef = doc(db, "familyGroups", input.ownerId);
      const groupSnap = await tx.get(groupRef);
      if (!groupSnap.exists()) {
        throw new Error("Selected family group no longer exists.");
      }
      const data = groupSnap.data();
      const memberUids = data.memberUids || [];

      // Enforce the full 2–4 invariant: array shape AND every listed
      // member back-references this group. Partial drift (some valid,
      // some not) must be repaired before logging a paid family tier.
      if (memberUids.length < 2 || memberUids.length > 4) {
        throw new Error(
          `"${data.name || input.ownerId}" has ${memberUids.length} listed member(s); a family must have 2 to 4. Repair the family on the Students page first.`
        );
      }

      const memberRefs = memberUids.map((uid) => doc(db, "users", uid));
      const memberSnaps = await Promise.all(
        memberRefs.map((ref) => tx.get(ref))
      );
      let validBackrefs = 0;
      for (const snap of memberSnaps) {
        if (snap.exists() && snap.data().familyGroupId === input.ownerId) {
          validBackrefs++;
        }
      }
      if (validBackrefs !== memberUids.length) {
        throw new Error(
          `"${data.name || input.ownerId}" has drift: ${validBackrefs} of the ${memberUids.length} listed members currently point back to this family. Repair on the Students page first.`
        );
      }

      // Bump the count so any concurrent dissolve detects this attach
      // even if its memberships-preflight query ran a moment before us.
      // (firestore.rules also REQUIRES this increment for family-membership
      // creates, so a stale tab or a console write can't skip it.)
      tx.update(groupRef, {
        familyMembershipCount: (data.familyMembershipCount || 0) + 1,
      });

      // Snapshot the membership roster onto the doc so former members
      // retain history visibility even after they leave the family or the
      // family is dissolved. Reads/rules use array-contains on this field.
      const newMemRef = doc(collection(db, "memberships"));
      tx.set(newMemRef, {
        ...buildMembershipDoc(input),
        memberUidsAtCreation: [...memberUids],
      });
      return newMemRef;
    });
  }
  return addDoc(collection(db, "memberships"), buildMembershipDoc(input));
}

// ─── Lesson purchases (bulk hours) ─────────────────────────────────────
export async function listLessonPurchasesForStudent(uid) {
  const snap = await getDocs(
    query(collection(db, "lessonPurchases"), where("studentId", "==", uid))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listAllLessonPurchases() {
  const snap = await getDocs(collection(db, "lessonPurchases"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function logLessonPurchase({
  studentId,
  type,
  hours,
  purchaseDate,
  notes,
  createdBy,
}) {
  return addDoc(collection(db, "lessonPurchases"), {
    studentId,
    type,
    hours: Number(hours),
    purchaseDate: Timestamp.fromDate(purchaseDate),
    notes: notes || "",
    createdBy,
    createdAt: serverTimestamp(),
  });
}

// ─── Lessons used ──────────────────────────────────────────────────────
export async function listLessonsUsedForStudent(uid) {
  const snap = await getDocs(
    query(collection(db, "lessonsUsed"), where("studentId", "==", uid))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listAllLessonsUsed() {
  const snap = await getDocs(collection(db, "lessonsUsed"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function logLessonUsed({
  studentId,
  date,
  type,
  hours,
  coachName,
  notes,
  createdBy,
}) {
  return addDoc(collection(db, "lessonsUsed"), {
    studentId,
    date: Timestamp.fromDate(date),
    type,
    hours: Number(hours),
    coachName: coachName || "",
    notes: notes || "",
    createdBy,
    createdAt: serverTimestamp(),
  });
}

// ─── Admin record deletes ──────────────────────────────────────────────
// Plain deletes for typo correction. Family-tier membership deletes do
// NOT decrement familyMembershipCount because the counter is monotonic
// (used only as a write-barrier between logMembership and dissolve, not
// as ground truth — the dissolve preflight QUERY is the authoritative
// active-membership check).
export function deleteMembershipRecord(id) {
  return deleteDoc(doc(db, "memberships", id));
}
export function deleteLessonPurchaseRecord(id) {
  return deleteDoc(doc(db, "lessonPurchases", id));
}
export function deleteLessonUsedRecord(id) {
  return deleteDoc(doc(db, "lessonsUsed", id));
}

// ─── Real-time listeners (admin dashboard) ─────────────────────────────
//
// Each returns an unsubscribe function. The callback is fired on the
// initial snapshot and on every subsequent change.

export function watchAllStudents(cb) {
  return onSnapshot(
    query(collection(db, "users"), where("role", "==", "student")),
    (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() })))
  );
}

export function watchFamilyGroups(cb) {
  return onSnapshot(collection(db, "familyGroups"), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  );
}

export function watchAllMemberships(cb) {
  return onSnapshot(collection(db, "memberships"), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  );
}

export function watchAllLessonPurchases(cb) {
  return onSnapshot(collection(db, "lessonPurchases"), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  );
}

export function watchAllLessonsUsed(cb) {
  return onSnapshot(collection(db, "lessonsUsed"), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  );
}
