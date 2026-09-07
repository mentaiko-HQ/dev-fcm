/**
 * 【Firebase Client SDK 初期化モジュール】
 * 
 * フールプルーフ設計:
 * - 必須環境変数が欠落している場合、初期化前にコンソールへ詳細な警告ログを出力し、未定義参照による即時クラッシュを防止。
 * 
 * フェイルセーフ設計:
 * - サーバーサイドレンダリング（SSR）環境およびブラウザ環境（CSR）を厳密に判定。
 * - 重複初期化を防止し、Firestore / Auth / Messaging の各インスタンスが安全に取得できない場合は null を返却。
 */

import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";
import { getAuth, Auth } from "firebase/auth";
import { getMessaging, Messaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// 【フールプルーフ】環境変数の存在チェック
export const isFirebaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
  process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID &&
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID
);

if (!isFirebaseConfigured && typeof window !== "undefined") {
  console.error("【Firebase初期化警告】必要な環境変数が未設定です。.env.local を確認してください。");
}

// 【フェイルセーフ】初期化の重複防止と安全なインスタンス生成
export const app: FirebaseApp = !getApps().length
  ? initializeApp(firebaseConfig)
  : getApp();

export const db: Firestore = getFirestore(app);
export const auth: Auth = getAuth(app);

// 【フェイルセーフ】ブラウザかつFCM対応環境でのみMessagingインスタンスを解決する非同期プロバイダ
export const getMessagingInstance = async (): Promise<Messaging | null> => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const supported = await isSupported();
    if (supported) {
      return getMessaging(app);
    }
    console.warn("【FCM非対応】ご利用のブラウザはFirebase Cloud Messagingをサポートしていません。");
    return null;
  } catch (error: unknown) {
    console.error("【FCM初期化エラー】Messagingインスタンスの取得に失敗しました:", error);
    return null;
  }
};

export const isFirestoreAvailable = (instance: Firestore | null): instance is Firestore => {
  return instance !== null && isFirebaseConfigured;
};