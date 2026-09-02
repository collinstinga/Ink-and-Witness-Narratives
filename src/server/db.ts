import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  initializeFirestore,
  getFirestore,
  setLogLevel,
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit,
  writeBatch,
  Firestore
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

// Suppress benign idle gRPC stream disconnect debug messages in Node.js server
setLogLevel('silent');

let dbInstance: Firestore | null = null;

export function getDb(): Firestore {
  if (dbInstance) {
    return dbInstance;
  }

  let config: any = null;
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      console.warn('[Firestore] Failed to parse firebase-applet-config.json:', e);
    }
  }

  if (!config) {
    config = {
      projectId: process.env.FIREBASE_PROJECT_ID || 'divine-experience-pq6d2',
      firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID || 'ai-studio-inkwitness-dec98f98-7fd5-48e7-b78f-2afc3b37afef'
    };
  }

  const app = getApps().length === 0 ? initializeApp({
    projectId: config.projectId,
    appId: config.appId,
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    storageBucket: config.storageBucket
  }) : getApp();

  try {
    dbInstance = initializeFirestore(app, {
      ignoreUndefinedProperties: true
    }, config.firestoreDatabaseId || undefined);
  } catch (err) {
    dbInstance = getFirestore(app, config.firestoreDatabaseId || undefined);
  }
  
  console.log(`[Firestore] Initialized Firestore connected to project: ${config.projectId}, db: ${config.firestoreDatabaseId || '(default)'}`);
  return dbInstance;
}

// Generic Document Helpers
export async function setFirestoreDoc(collectionName: string, docId: string, data: any): Promise<void> {
  try {
    const db = getDb();
    const docRef = doc(db, collectionName, docId);
    await setDoc(docRef, sanitizeForFirestore(data), { merge: true });
  } catch (err) {
    console.error(`[Firestore] Error writing ${collectionName}/${docId}:`, err);
  }
}

export async function getFirestoreDoc<T = any>(collectionName: string, docId: string): Promise<T | null> {
  try {
    const db = getDb();
    const docRef = doc(db, collectionName, docId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as T;
    }
    return null;
  } catch (err) {
    console.error(`[Firestore] Error reading ${collectionName}/${docId}:`, err);
    return null;
  }
}

export async function deleteFirestoreDoc(collectionName: string, docId: string): Promise<void> {
  try {
    const db = getDb();
    const docRef = doc(db, collectionName, docId);
    await deleteDoc(docRef);
  } catch (err) {
    console.error(`[Firestore] Error deleting ${collectionName}/${docId}:`, err);
  }
}

export async function getAllFirestoreDocs<T = any>(collectionName: string): Promise<T[]> {
  try {
    const db = getDb();
    const colRef = collection(db, collectionName);
    const snap = await getDocs(colRef);
    return snap.docs.map(d => d.data() as T);
  } catch (err) {
    console.error(`[Firestore] Error fetching all docs from ${collectionName}:`, err);
    return [];
  }
}

// Remove undefined fields which Firestore rejects
export function sanitizeForFirestore(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore);
  }
  if (typeof obj === 'object') {
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        clean[key] = sanitizeForFirestore(value);
      }
    }
    return clean;
  }
  return obj;
}
