import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

let dbInstance: Firestore | null = null;
const SERVER_FIREBASE_APP_NAME = 'ink-witness-server-firestore';

export interface FirestoreTargetConfig {
  projectId: string;
  firestoreDatabaseId: string;
}

const boundClientTargets = new WeakMap<Firestore, Readonly<FirestoreTargetConfig>>();

/** Target recorded when this module actually constructs the client, not env labels. */
export function getFirestoreClientTarget(client: Firestore): FirestoreTargetConfig | null {
  const target = boundClientTargets.get(client);
  return target ? { ...target } : null;
}

/**
 * Resolve the exact target used by getDb(). Environment overrides take
 * precedence so maintenance scripts cannot validate one project while the
 * Firebase client silently opens the project named in the checked-in config.
 */
export function resolveFirestoreTargetConfig(cwd = process.cwd()): FirestoreTargetConfig {
  const configPath = path.join(cwd, 'firebase-applet-config.json');
  let fileConfig: { projectId?: string; firestoreDatabaseId?: string } = {};
  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as typeof fileConfig;
    } catch (error) {
      console.warn('[Firestore] Failed to parse firebase-applet-config.json:', error);
    }
  }
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim()
    || fileConfig.projectId?.trim()
    || 'ink-and-witness-narratives';
  const firestoreDatabaseId = process.env.FIRESTORE_DATABASE_ID?.trim()
    || fileConfig.firestoreDatabaseId?.trim()
    || '(default)';
  return { projectId, firestoreDatabaseId };
}

export function getDb(): Firestore {
  if (dbInstance) return dbInstance;

  const config = resolveFirestoreTargetConfig();
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (process.env.VERCEL && !rawServiceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required on Vercel');
  }

  let credential;
  if (rawServiceAccount) {
    try {
      credential = cert(JSON.parse(rawServiceAccount));
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
  } else {
    credential = applicationDefault();
  }

  const existingApp = getApps().find(candidate => candidate.name === SERVER_FIREBASE_APP_NAME);
  if (existingApp?.options.projectId && existingApp.options.projectId !== config.projectId) {
    throw new Error('Firebase server app is already bound to a different project.');
  }
  const app = existingApp || initializeApp({
    credential,
    projectId: config.projectId
  }, SERVER_FIREBASE_APP_NAME);
  const databaseId = config.firestoreDatabaseId;
  dbInstance = databaseId && databaseId !== '(default)'
    ? getFirestore(app, databaseId)
    : getFirestore(app);
  dbInstance.settings({ ignoreUndefinedProperties: true });
  boundClientTargets.set(dbInstance, Object.freeze({ ...config }));

  console.log(`[Firestore] Initialized private server connection to project: ${config.projectId}, db: ${databaseId || '(default)'}`);
  return dbInstance;
}

export async function setFirestoreDoc(collectionName: string, docId: string, data: any): Promise<void> {
  try {
    await getDb().collection(collectionName).doc(docId).set(sanitizeForFirestore(data), { merge: true });
  } catch (error) {
    console.error(`[Firestore] Error writing ${collectionName}/${docId}:`, error);
    throw error;
  }
}

/** Replace one owned document so intentionally omitted optional fields stay cleared. */
export async function replaceFirestoreDoc(collectionName: string, docId: string, data: any): Promise<void> {
  try {
    await getDb().collection(collectionName).doc(docId).set(sanitizeForFirestore(data));
  } catch (error) {
    console.error(`[Firestore] Error replacing ${collectionName}/${docId}:`, error);
    throw error;
  }
}

export async function updateFirestoreDoc(collectionName: string, docId: string, data: any): Promise<void> {
  try {
    await getDb().collection(collectionName).doc(docId).update(sanitizeForFirestore(data));
  } catch (error) {
    console.error(`[Firestore] Error updating ${collectionName}/${docId}:`, error);
    throw error;
  }
}

export async function getFirestoreDoc<T = any>(collectionName: string, docId: string): Promise<T | null> {
  try {
    const snapshot = await getDb().collection(collectionName).doc(docId).get();
    return snapshot.exists ? snapshot.data() as T : null;
  } catch (error) {
    console.error(`[Firestore] Error reading ${collectionName}/${docId}:`, error);
    throw error;
  }
}

export async function deleteFirestoreDoc(collectionName: string, docId: string): Promise<void> {
  try {
    await getDb().collection(collectionName).doc(docId).delete();
  } catch (error) {
    console.error(`[Firestore] Error deleting ${collectionName}/${docId}:`, error);
    throw error;
  }
}

export async function getAllFirestoreDocs<T = any>(collectionName: string): Promise<T[]> {
  try {
    const snapshot = await getDb().collection(collectionName).get();
    return snapshot.docs.map(document => document.data() as T);
  } catch (error) {
    console.error(`[Firestore] Error fetching all docs from ${collectionName}:`, error);
    throw error;
  }
}

export function sanitizeForFirestore(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (obj instanceof Date || obj instanceof Uint8Array) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  if (typeof obj === 'object') {
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) clean[key] = sanitizeForFirestore(value);
    }
    return clean;
  }
  return obj;
}
