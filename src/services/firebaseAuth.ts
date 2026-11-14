import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence,
  User,
  Auth
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: String(import.meta.env.VITE_FIREBASE_API_KEY || '').trim(),
  authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
  projectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim(),
  storageBucket: String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
  messagingSenderId: String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
  appId: String(import.meta.env.VITE_FIREBASE_APP_ID || '').trim(),
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

const TOKEN_STORAGE_KEY = 'pcmc_google_oauth_token';
const TOKEN_EXP_STORAGE_KEY = 'pcmc_google_oauth_token_exp';
// Google OAuth access tokens typically last 60 minutes; cache for 50 minutes cleanly.
const TOKEN_TTL_MS = 50 * 60 * 1000;

let app: FirebaseApp | null = null;
export let auth: Auth | null = null;

if (isFirebaseConfigured) {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn('Could not enforce browserLocalPersistence:', err);
  });
}

let cachedAccessToken: string | null = null;

function saveAccessTokenToStorage(token: string) {
  cachedAccessToken = token;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(TOKEN_EXP_STORAGE_KEY, String(Date.now() + TOKEN_TTL_MS));
  } catch {
    // Ignore storage quota errors
  }
}

function loadValidAccessTokenFromStorage(): string | null {
  if (cachedAccessToken) {
    try {
      const exp = Number(localStorage.getItem(TOKEN_EXP_STORAGE_KEY) || 0);
      if (exp === 0 || Date.now() < exp) {
        return cachedAccessToken;
      }
    } catch {
      return cachedAccessToken;
    }
  }

  try {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    const exp = Number(localStorage.getItem(TOKEN_EXP_STORAGE_KEY) || 0);
    if (token && exp > Date.now()) {
      cachedAccessToken = token;
      return token;
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

function clearAccessTokenFromStorage() {
  cachedAccessToken = null;
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_EXP_STORAGE_KEY);
  } catch {
    // Ignore storage removal errors
  }
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  if (!auth) {
    if (onAuthFailure) onAuthFailure();
    return () => {};
  }

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const token = loadValidAccessTokenFromStorage() || '';
      if (onAuthSuccess) onAuthSuccess(user, token);
    } else {
      clearAccessTokenFromStorage();
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (loginHint?: string): Promise<{ user: User; accessToken: string } | null> => {
  if (!auth) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า Firebase Credentials (VITE_FIREBASE_*) กรุณากำหนดใน GitHub Secrets แล้วสั่ง Re-run Deploy หรือตั้งค่าใน .env.local'
    );
  }

  try {
    await setPersistence(auth, browserLocalPersistence);
    const signInProvider = new GoogleAuthProvider();
    signInProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
    signInProvider.addScope('https://www.googleapis.com/auth/drive.file');
    signInProvider.addScope('https://www.googleapis.com/auth/forms.body');
    if (loginHint) {
      signInProvider.setCustomParameters({ login_hint: loginHint });
    } else {
      signInProvider.setCustomParameters({ prompt: 'select_account' });
    }
    const result = await signInWithPopup(auth, signInProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('ไม่ได้รับ Access Token จาก Google Auth');
    }

    saveAccessTokenToStorage(credential.accessToken);
    return { user: result.user, accessToken: credential.accessToken };
  } catch (error: unknown) {
    console.error('Sign in error:', error);
    const errCode = (error as { code?: string })?.code || '';
    if (errCode === 'auth/unauthorized-domain') {
      throw new Error(
        `โดเมน ${window.location.hostname} ยังไม่ได้รับอนุญาต กรุณาเพิ่มโดเมนนี้ใน Firebase Console -> Authentication -> Settings -> Authorized domains`
      );
    }
    if (errCode === 'auth/popup-blocked') {
      throw new Error('เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป กรุณาอนุญาต Pop-up แล้วลองใหม่อีกครั้ง');
    }
    if (errCode === 'auth/popup-closed-by-user') {
      throw new Error('ยกเลิกการเข้าสู่ระบบ (ปิดหน้าต่าง Google Sign-In)');
    }
    if (errCode === 'auth/operation-not-allowed') {
      throw new Error('ยังไม่ได้เปิดใช้งาน Google Provider ใน Firebase Console -> Authentication -> Sign-in method');
    }
    throw error;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return loadValidAccessTokenFromStorage();
};

export const logout = async () => {
  if (auth) {
    await signOut(auth);
  }
  clearAccessTokenFromStorage();
};
