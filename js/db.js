import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
  onSnapshot,
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

export function updateUserProfile(uid, patch) {
  return updateDoc(doc(db, "users", uid), patch);
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

export async function createFamilyGroup(name, memberUids) {
  return addDoc(collection(db, "familyGroups"), {
    name,
    memberUids,
    createdAt: serverTimestamp(),
  });
}

export function updateFamilyGroup(id, patch) {
  return updateDoc(doc(db, "familyGroups", id), patch);
}

// ─── Memberships ───────────────────────────────────────────────────────
export async function listMembershipsForStudent(uid, familyGroupId) {
  const out = [];
  const own = await getDocs(
    query(
      collection(db, "memberships"),
      where("ownerType", "==", "student"),
      where("ownerId", "==", uid)
    )
  );
  own.forEach((d) => out.push({ id: d.id, ...d.data() }));

  if (familyGroupId) {
    const fam = await getDocs(
      query(
        collection(db, "memberships"),
        where("ownerType", "==", "family"),
        where("ownerId", "==", familyGroupId)
      )
    );
    fam.forEach((d) => out.push({ id: d.id, ...d.data() }));
  }
  return out;
}

export async function listAllMemberships() {
  const snap = await getDocs(
    query(collection(db, "memberships"), orderBy("validUntil", "desc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function logMembership({
  ownerType,
  ownerId,
  tier,
  validFrom,
  validUntil,
  purchaseDate,
  notes,
  createdBy,
}) {
  return addDoc(collection(db, "memberships"), {
    ownerType,
    ownerId,
    tier,
    validFrom: Timestamp.fromDate(validFrom),
    validUntil: Timestamp.fromDate(validUntil),
    purchaseDate: Timestamp.fromDate(purchaseDate),
    notes: notes || "",
    createdBy,
    createdAt: serverTimestamp(),
  });
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
