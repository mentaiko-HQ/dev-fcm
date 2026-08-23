import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";
import { getMessaging, Messaging } from "firebase/messaging";

// フールプルーフ: 環境変数の欠落を早期検知
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
};

// 有効な設定値が存在するか判定（フェイルセーフ: 設定不備時に接続処理を安全に遮断）
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.apiKey !== "dummy_api_key" &&
  firebaseConfig.projectId &&
  firebaseConfig.projectId !== "dummy_project"
);

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let messaging: Messaging | null = null;

if (isFirebaseConfigured) {
  try {
    // フェイルセーフ: アプリの多重初期化を防止
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    db = getFirestore(app);

    // ブラウザ環境かつService Workerサポート環境のみでFCMを初期化
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      messaging = getMessaging(app);
    }
  } catch (error) {
    // フェイルセーフ: 初期化障害時のログ出力と例外安全性の確保
    console.error("【エラーログ】Firebase SDKの初期化中にエラーが発生しました:", error);
    app = null;
    db = null;
    messaging = null;
  }
} else {
  console.warn("【警告】Firebase環境変数が未設定です。ローカルフォールバックモードで動作します。");
}

/**
 * Firestoreインスタンスが利用可能か検証する型ガード関数（フールプルーフ）
 */
export function isFirestoreAvailable(database: Firestore | null): database is Firestore {
  return database !== null;
}

export { app, db, messaging };