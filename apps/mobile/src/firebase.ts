import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const app = getApps().length ? getApp() : initializeApp({
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
});

// Persist Firebase Authentication across Android/iOS app restarts.
// Fast Refresh can evaluate this module more than once; reuse the initialized client then.
let nativeAuth;
try {
  nativeAuth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
} catch {
  nativeAuth = getAuth(app);
}
export const auth = nativeAuth;
export const db = getFirestore(app);
export const storage = getStorage(app);
