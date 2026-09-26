import '../lib/suppressFirestoreWarnings';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  Firestore,
} from 'firebase/firestore';
import { User, GroupSettings, RestDay, RecitationLog, RevisionLog } from '../types';
import firebaseConfig from '../../firebase-applet-config.json';

export type UserWithPassword = User & { password_hash: string };

let firestoreInstance: Firestore | null = null;
let isConnected = false;

export async function ensureServerAuth(): Promise<void> {
  // Ensure Firebase app instance is properly initialized for Firestore access
  if (getApps().length === 0) {
    initializeApp(firebaseConfig);
  }
}

export function getFirestoreDB(): Firestore {
  if (!firestoreInstance) {
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    const dbId = (firebaseConfig as any).firestoreDatabaseId;
    firestoreInstance = dbId ? getFirestore(app, dbId) : getFirestore(app);
  }
  return firestoreInstance;
}

export async function testFirestoreConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureServerAuth();
    const db = getFirestoreDB();
    await getDoc(doc(db, 'users', 'probe_conn'));
    isConnected = true;
    const dbId = (firebaseConfig as any).firestoreDatabaseId || '(default)';
    console.log(`[Firestore LIVE] Successfully connected to project: ${firebaseConfig.projectId} (db: ${dbId})`);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Firestore Warning] Connection check result: ${message}`);
    return { success: false, error: message };
  }
}

// ----------------------------------------------------
// USERS COLLECTION (Collection: 'users')
// ----------------------------------------------------

function normalizeUserFromFirestore(docId: string, rawData: Record<string, unknown>): UserWithPassword {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawData)) {
    const cleanKey = key.trim().toLowerCase();
    const cleanVal = typeof value === 'string' ? value.trim() : value;
    clean[cleanKey] = cleanVal;
  }

  const phone = clean['phone'] || clean['mobile'] || clean['phone_number'] || clean['phonenumber'] || '';
  const password = clean['password_hash'] || clean['password'] || clean['pass'] || '';
  const name = clean['name'] || clean['display_name'] || clean['fullname'] || clean['user_name'] || docId;
  const role = clean['role'] === 'admin' ? 'admin' : 'member';
  const isActive = typeof clean['is_active'] === 'boolean' ? clean['is_active'] : true;
  const createdAt = clean['created_at'] || new Date().toISOString();
  const id = (clean['id'] as string) || docId;

  return {
    id: String(id).trim(),
    name: String(name).trim(),
    phone: String(phone).trim(),
    role,
    password_hash: String(password).trim(),
    is_active: isActive,
    created_at: String(createdAt).trim(),
    firebase_uid: clean['firebase_uid'] ? String(clean['firebase_uid']).trim() : undefined,
  };
}

export async function getLiveUsers(): Promise<UserWithPassword[]> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  console.log(`[Firestore LIVE Read] Fetching all documents from 'users' collection in ${firebaseConfig.projectId}...`);
  const snap = await getDocs(collection(db, 'users'));
  const users: UserWithPassword[] = [];
  snap.forEach((d) => {
    if (d.id === 'probe_conn') return;
    const rawData = d.data() as Record<string, unknown>;
    const user = normalizeUserFromFirestore(d.id, rawData);
    users.push(user);
  });
  console.log(`[Firestore LIVE Read] Retrieved ${users.length} users from Firestore.`);
  return users;
}

/**
 * Recursively strips all `undefined` values from an object or array before writing to Firestore.
 * Firestore strictly rejects `undefined` values in setDoc() and updateDoc() with:
 * "Unsupported field value: undefined".
 */
export function cleanForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as unknown as T;
  }
  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined)
      .map((item) => cleanForFirestore(item)) as unknown as T;
  }
  if (typeof data === 'object' && !(data instanceof Date)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (value !== undefined) {
        cleaned[key] = cleanForFirestore(value);
      }
    }
    return cleaned as T;
  }
  return data;
}

export async function createLiveUser(user: UserWithPassword): Promise<void> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  const cleanPayload = cleanForFirestore(user);
  console.log(`[Firestore LIVE Write] Writing user doc '${user.id}' into 'users' collection in ${firebaseConfig.projectId}...`);
  await setDoc(doc(db, 'users', user.id), cleanPayload);
  console.log(`[Firestore LIVE Write] User '${user.name}' (${user.id}) successfully committed to Firestore.`);
}

export async function updateLiveUser(id: string, updates: Partial<UserWithPassword>): Promise<void> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  const cleanPayload = cleanForFirestore(updates);
  console.log(`[Firestore LIVE Write] Updating user doc '${id}' in 'users' collection in ${firebaseConfig.projectId}...`);
  await updateDoc(doc(db, 'users', id), cleanPayload);
  console.log(`[Firestore LIVE Write] User '${id}' successfully updated in Firestore.`);
}

export async function deleteLiveUser(id: string): Promise<void> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  console.log(`[Firestore LIVE Write] Deleting user doc '${id}' in 'users' collection in ${firebaseConfig.projectId}...`);
  await deleteDoc(doc(db, 'users', id));
  console.log(`[Firestore LIVE Write] User '${id}' successfully deleted from Firestore.`);
}

// ----------------------------------------------------
// SETTINGS COLLECTION (Collection: 'settings', Doc: 'group_settings')
// ----------------------------------------------------

export async function getLiveSettings(): Promise<GroupSettings | null> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  const snap = await getDoc(doc(db, 'settings', 'group_settings'));
  if (!snap.exists()) return null;
  return snap.data() as GroupSettings;
}

export async function saveLiveSettings(settings: GroupSettings): Promise<void> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  const cleanPayload = cleanForFirestore(settings);
  console.log(`[Firestore LIVE Write] Saving group_settings doc in 'settings' collection in ${firebaseConfig.projectId}...`);
  await setDoc(doc(db, 'settings', 'group_settings'), cleanPayload);
}

// ----------------------------------------------------
// REST DAYS COLLECTION (Collection: 'rest_days')
// ----------------------------------------------------

export async function getLiveRestDays(): Promise<RestDay[]> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  const snap = await getDocs(collection(db, 'rest_days'));
  const restDays: RestDay[] = [];
  snap.forEach((d) => {
    restDays.push({ ...(d.data() as RestDay), id: d.id });
  });
  return restDays;
}

export async function addLiveRestDay(restDay: RestDay): Promise<void> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  const cleanPayload = cleanForFirestore(restDay);
  console.log(`[Firestore LIVE Write] Adding rest_day doc '${restDay.id}' (${restDay.date}) in ${firebaseConfig.projectId}...`);
  await setDoc(doc(db, 'rest_days', restDay.id), cleanPayload);
}

export async function deleteLiveRestDay(id: string): Promise<void> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  console.log(`[Firestore LIVE Write] Deleting rest_day doc '${id}' in ${firebaseConfig.projectId}...`);
  await deleteDoc(doc(db, 'rest_days', id));
}

// ----------------------------------------------------
// RECITATION LOGS COLLECTION (Collection: 'recitations')
// ----------------------------------------------------

export async function getLiveRecitations(): Promise<RecitationLog[]> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  const snap = await getDocs(collection(db, 'recitations'));
  const logs: RecitationLog[] = [];
  snap.forEach((d) => {
    logs.push({ ...(d.data() as RecitationLog), id: d.id });
  });
  return logs;
}

export async function addLiveRecitation(log: RecitationLog): Promise<void> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  const cleanPayload = cleanForFirestore(log);
  console.log(`[Firestore LIVE Write] Adding recitation doc '${log.id}' for member '${log.member_name}' in ${firebaseConfig.projectId}...`);
  await setDoc(doc(db, 'recitations', log.id), cleanPayload);
}

export async function deleteLiveRecitationsForMember(memberId: string): Promise<number> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  const snap = await getDocs(collection(db, 'recitations'));
  let count = 0;
  const deletePromises: Promise<void>[] = [];
  snap.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    const reciter = data['member_id'] || data['reciter_id'];
    if (reciter === memberId) {
      deletePromises.push(deleteDoc(doc(db, 'recitations', d.id)));
      count++;
    }
  });
  await Promise.all(deletePromises);
  console.log(`[Firestore LIVE Write] Deleted ${count} recitation logs for member '${memberId}' in ${firebaseConfig.projectId}.`);
  return count;
}

// ----------------------------------------------------
// REVISION LOGS COLLECTION (Collection: 'revisions')
// ----------------------------------------------------

export async function getLiveRevisions(): Promise<RevisionLog[]> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  const snap = await getDocs(collection(db, 'revisions'));
  const logs: RevisionLog[] = [];
  snap.forEach((d) => {
    logs.push({ ...(d.data() as RevisionLog), id: d.id });
  });
  return logs;
}

export async function addLiveRevision(log: RevisionLog): Promise<void> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  const cleanPayload = cleanForFirestore(log);
  console.log(`[Firestore LIVE Write] Adding revision doc '${log.id}' for member '${log.member_name}' in ${firebaseConfig.projectId}...`);
  await setDoc(doc(db, 'revisions', log.id), cleanPayload);
}

export async function deleteLiveRevisionsForMember(memberId: string): Promise<number> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  const snap = await getDocs(collection(db, 'revisions'));
  let count = 0;
  const deletePromises: Promise<void>[] = [];
  snap.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    if (data['member_id'] === memberId) {
      deletePromises.push(deleteDoc(doc(db, 'revisions', d.id)));
      count++;
    }
  });
  await Promise.all(deletePromises);
  console.log(`[Firestore LIVE Write] Deleted ${count} revision logs for member '${memberId}' in ${firebaseConfig.projectId}.`);
  return count;
}

// ----------------------------------------------------
// INITIAL SEEDING TO FIRESTORE
// ----------------------------------------------------

export async function seedFirestoreIfEmpty(initialData: {
  users: UserWithPassword[];
  settings: GroupSettings;
  restDays: RestDay[];
  recitationLogs: RecitationLog[];
  revisionLogs: RevisionLog[];
}): Promise<void> {
  try {
    const existingUsers = await getLiveUsers();
    if (existingUsers.length === 0) {
      console.log(`[Firestore LIVE Seed] 'users' collection is empty. Seeding initial users into ${firebaseConfig.projectId}...`);
      for (const u of initialData.users) {
        await createLiveUser(u);
      }
      await saveLiveSettings(initialData.settings);
      for (const rd of initialData.restDays) {
        await addLiveRestDay(rd);
      }
      for (const rec of initialData.recitationLogs) {
        await addLiveRecitation(rec);
      }
      for (const rev of initialData.revisionLogs) {
        await addLiveRevision(rev);
      }
      console.log(`[Firestore LIVE Seed] Seeding completed successfully!`);
    } else {
      console.log(`[Firestore LIVE] Found ${existingUsers.length} existing users in Firestore collection. No seed needed.`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Firestore LIVE Seed Notice] Could not auto-seed: ${message}`);
  }
}

export async function clearAllLiveLogsAndRestDays(): Promise<void> {
  await ensureServerAuth();
  const db = getFirestoreDB();
  console.log(`[Firestore LIVE Write] Clearing all recitations, revisions, and rest days for factory reset in ${firebaseConfig.projectId}...`);
  const recSnap = await getDocs(collection(db, 'recitations'));
  const recDeletes = recSnap.docs.map((d) => deleteDoc(doc(db, 'recitations', d.id)));
  const revSnap = await getDocs(collection(db, 'revisions'));
  const revDeletes = revSnap.docs.map((d) => deleteDoc(doc(db, 'revisions', d.id)));
  const restSnap = await getDocs(collection(db, 'rest_days'));
  const restDeletes = restSnap.docs.map((d) => deleteDoc(doc(db, 'rest_days', d.id)));
  await Promise.all([...recDeletes, ...revDeletes, ...restDeletes]);
  console.log(`[Firestore LIVE Write] Factory reset Firestore clearance completed.`);
}

