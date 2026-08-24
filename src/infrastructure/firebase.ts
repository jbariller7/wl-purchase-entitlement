import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getAppCheck, type AppCheck } from "firebase-admin/app-check";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import { env } from "../config/env.js";

let app: App | undefined;

export function firebaseApp(): App {
  if (app) return app;
  app = getApps()[0] ?? initializeApp({
    credential: cert({
      projectId: env().FIREBASE_PROJECT_ID,
      clientEmail: env().FIREBASE_CLIENT_EMAIL,
      privateKey: env().FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    }),
    storageBucket: env().FIREBASE_STORAGE_BUCKET
  });
  getFirestore(app).settings({ ignoreUndefinedProperties: true });
  return app;
}

export function firebaseAuth(): Auth { return getAuth(firebaseApp()); }
export function firebaseAppCheck(): AppCheck { return getAppCheck(firebaseApp()); }
export function firestore(): Firestore { return getFirestore(firebaseApp()); }
export function firebaseStorage(): Storage { return getStorage(firebaseApp()); }
