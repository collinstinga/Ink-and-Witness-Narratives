import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

let dbInstance: Firestore | null = null;

function loadFirebaseConfig(): any {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (error) {
      console.warn('[Firestore] Failed to parse firebase-applet-config.json:', error);
    }
  }
  return {
    projectId: process.env.FIREBASE_PROJECT_ID || 'ink-and-witness-narratives',
    firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID || '(default)'
  };
}

export function getDb(): Firestore {
  if (dbInstance) return dbInstance;

  const config = loadFirebaseConfig();
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

  const app = getApps()[0] || initializeApp({
    credential,
    projectId: config.projectId
  });
  const databaseId = config.firestoreDatabaseId;
  dbInstance = databaseId && databaseId !== '(default)'
    ? getFirestore(app, databaseId)
    : getFirestore(app);
  dbInstance.settings({ ignoreUndefinedProperties: true });

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
