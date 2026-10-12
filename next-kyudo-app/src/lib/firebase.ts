/**
 * 【Firebase SDK 初期化およびクライアント接続モジュール】
 *
 * 役割:
 * - Next.js (App Router) 環境において Firebase App、Firestore、Auth、Storage、Messaging を初期化。
 * - 多重初期化の防止（getApps によるシングルトン制御）。
 * - 匿名認証セッションの保証（ensureAnonymousAuth）。
 * - FCM Messaging インスタンス取得関数（getMessagingInstance / getClientMessaging）の互換エクスポート。
 *
 * フールプルーフ設計（未然のクラッシュ遮断）:
 * - サーバーサイドレンダリング（SSR / SSG）実行時に window や ServiceWorker が存在しないため、
 *   ブラウザ環境でのみ Messaging 初期化を実行。
 * - 環境変数欠落時の早期検知フラグ（isFirebaseConfigured）。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - SSR時でも Firestore / Auth / Storage のインスタンスは正常生成し、Null参照例外によるサーバークラッシュを完全防止。
 * - Messaging isSupported() による機能判定を実施し、非対応ブラウザ（プライベートブラウズ、非PWA等）では
 *   例外を投げずに null を返却して安全に縮退動作。
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getAuth, Auth, signInAnonymously } from 'firebase/auth';
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

// 必須環境変数の設定確認フラグ
export const isFirebaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
);

// シングルトン初期化（SSR・ブラウザ環境双方で安全にインスタンスを確立）
const app: FirebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db: Firestore = getFirestore(app);
const auth: Auth = getAuth(app);
const storage: FirebaseStorage = getStorage(app);

/**
 * Firestore接続可否判定関数
 */
export function isFirestoreAvailable(
  instance: Firestore | null | undefined,
): boolean {
  return Boolean(instance && isFirebaseConfigured);
}

/**
 * 【FCM Messaging インスタンス安全取得関数】
 */
export async function getMessagingInstance(): Promise<Messaging | null> {
  if (typeof window === 'undefined') {
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

/**
 * 既存コード互換用エイリアス
 */
export const getClientMessaging = getMessagingInstance;

/**
 * 【匿名認証セッション保証関数】
 *
 * 役割:
 * - 未ログイン状態による Firestore の権限エラー（Missing or insufficient permissions）を防止。
 * - 既にログイン済みの場合は既存の UID を返却し、未ログイン時のみ signInAnonymously を実行。
 */
export async function ensureAnonymousAuth(): Promise<string | null> {
  try {
    if (auth.currentUser) {
      return auth.currentUser.uid;
    }
    const userCredential = await signInAnonymously(auth);
    return userCredential.user.uid;
  } catch (error: unknown) {
    console.error(
      '【Firebase Authエラー】匿名認証の確立に失敗しました:',
      error,
    );
    return null;
  }
}

export { app, db, auth, storage };
