import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getMessaging, Messaging } from 'firebase/messaging';

// フールプルーフ: 環境変数の欠落を早期検出
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error(
    '【エラーログ】Firebase初期化に必要な環境変数が未設定です。.env.localを確認してください。',
  );
}

let app: FirebaseApp;
let db: Firestore;
let messaging: Messaging | null = null;

try {
  // フェイルセーフ: アプリの多重初期化を防止
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(app);

  // ブラウザ環境かつService Workerサポート環境のみでFCMを安全に初期化
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    messaging = getMessaging(app);
  }
} catch (error) {
  // フェイルセーフ: 初期化障害時のログ出力と例外安全性の確保
  console.error(
    '【エラーログ】Firebase SDKの初期化中にエラーが発生しました:',
    error,
  );
  throw error;
}

export { app, db, messaging };
