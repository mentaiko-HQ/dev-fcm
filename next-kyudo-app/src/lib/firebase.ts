/**
 * 【Firebase SDK 初期化およびクライアント接続モジュール】
 *
 * 役割:
 * - Next.js クライアント環境において Firebase App、Firestore、Auth、Storage、Messaging を初期化。
 * - 多重初期化の防止（getApps 照合）。
 * - FCM Messaging インスタンス取得関数（getMessagingInstance）のエクスポート。
 *
 * フールプルーフ設計（未然のクラッシュ遮断）:
 * - サーバーサイドレンダリング（SSR / SSG）実行時に window オブジェクトが存在しないため、
 *   ブラウザ環境でのみ Messaging 初期化を実行。
 * - 環境変数欠落時の安全な検知フラグ（isFirebaseConfigured）。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - Firebase Messaging の isSupported() によるブラウザ機能判定を実施し、
 *   非対応ブラウザ（プライベートブラウズ、古い環境等）で例外を投げずに null を返却して安全縮退。
 * - インスタンス生成エラー発生時はスタックトレースをログ出力し、null を返却。
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { getMessaging, isSupported, Messaging } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
);

let app: FirebaseApp | undefined;
let db: Firestore;
let auth: Auth;
let storage: FirebaseStorage;

if (typeof window !== 'undefined' || getApps().length > 0) {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(app);
  auth = getAuth(app);
  storage = getStorage(app);
} else {
  app = undefined;
  db = null as unknown as Firestore;
  auth = null as unknown as Auth;
  storage = null as unknown as FirebaseStorage;
}

export function isFirestoreAvailable(
  instance: Firestore | null | undefined,
): boolean {
  return Boolean(instance && isFirebaseConfigured);
}

/**
 * 【FCM Messaging インスタンス安全取得関数】
 *
 * 判断基準:
 * 1. SSR環境（window未定義）の場合は即座に null を返却。
 * 2. Firebase App 未初期化時は null を返却。
 * 3. ブラウザが FCM / ServiceWorker に対応しているか (isSupported) を非同期検証。
 * 4. 非対応または初期化失敗時は例外を外へ漏らさず null を返却。
 */
export async function getMessagingInstance(): Promise<Messaging | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!app) {
    console.warn(
      '【FCM】Firebase App が初期化されていないため、Messagingを取得できません。',
    );
    return null;
  }

  try {
    const supported = await isSupported();
    if (!supported) {
      console.warn(
        '【FCM】このブラウザ環境は Firebase Cloud Messaging (Web Push) に対応していません。',
      );
      return null;
    }
    return getMessaging(app);
  } catch (error: unknown) {
    console.error(
      '【FCM初期化エラー】Messaging インスタンスの生成に失敗しました:',
      error,
    );
    return null;
  }
}

export { app, db, auth, storage };
