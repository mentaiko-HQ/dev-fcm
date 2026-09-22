/**
 * 【Firebase Client SDK 初期化モジュール】
 *
 * 役割:
 * - Firebase App, Firestore, Auth, Messaging (FCM) の初期化およびシングルトン管理。
 * - 環境変数の静的検証と利用可否ステータスの提供。
 *
 * フールプルーフ設計（操作ミス・環境差異の入口遮断）:
 * - Next.jsの仕様に準拠し、すべての環境変数を動的参照（process.env[key]）ではなく
 *   静的参照（process.env.NEXT_PUBLIC_*）で明示的に抽出し、ブラウザでの置換漏れを完全に排除。
 * - プレースホルダー文字列（your-project-id, AIzaSyXXX 等）が残存している場合は
 *   本番通信を行わず警告を出力。
 * - `isFirestoreAvailable` で `Firestore | null | undefined` を受け入れ、安全に型を絞り込む。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - 必須キーが欠落している場合でも、初期化例外（Invalid API key）で画面全体をクラッシュさせず、
 *   ダミー初期化を実行して `isFirebaseConfigured = false` を維持。
 * - SSR環境およびブラウザ環境を厳密に判定し、サーバーサイドでの Messaging 実行例外を防止。
 * - 重複初期化防止（getApps によるシングルトン再利用）。
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';
import { getMessaging, Messaging, isSupported } from 'firebase/messaging';

// 【フールプルーフ】静的参照による環境変数の個別抽出（Next.jsのインライン置換を保証）
const rawApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const rawAuthDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
const rawProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const rawStorageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
const rawMessagingSenderId =
  process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
const rawAppId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

// 値の妥当性判定ヘルパー（空文字、未定義、プレースホルダーを排除）
function isValidEnvValue(val: string | undefined): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  if (trimmed === '') return false;
  if (
    trimmed.includes('your-project-id') ||
    trimmed.includes('AIzaSyXXX') ||
    trimmed.includes('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX') ||
    trimmed.includes('your-app-id') ||
    trimmed.includes('ここにFirebaseコンソールの')
  ) {
    return false;
  }
  return true;
}

// 各環境変数の検証
export const envStatus = {
  apiKey: isValidEnvValue(rawApiKey),
  projectId: isValidEnvValue(rawProjectId),
  messagingSenderId: isValidEnvValue(rawMessagingSenderId),
  appId: isValidEnvValue(rawAppId),
};

export const isFirebaseConfigured: boolean =
  envStatus.apiKey &&
  envStatus.projectId &&
  envStatus.messagingSenderId &&
  envStatus.appId;

// 不備がある場合のみコンソールへ警告を出力
if (!isFirebaseConfigured && typeof window !== 'undefined') {
  const missingList: string[] = [];
  if (!envStatus.apiKey) missingList.push('NEXT_PUBLIC_FIREBASE_API_KEY');
  if (!envStatus.projectId) missingList.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  if (!envStatus.messagingSenderId)
    missingList.push('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID');
  if (!envStatus.appId) missingList.push('NEXT_PUBLIC_FIREBASE_APP_ID');

  console.warn(
    `【Firebase設定警告】以下の環境変数が未設定または無効です (.env.local を確認してください):\n` +
      missingList.map((k) => ` - ${k}`).join('\n') +
      `\n※ .env.local 修正後は Next.js サーバー (npm run dev) の再起動が必要です。`,
  );
}

const firebaseConfig = {
  apiKey: rawApiKey || '',
  authDomain: rawAuthDomain || '',
  projectId: rawProjectId || '',
  storageBucket: rawStorageBucket || '',
  messagingSenderId: rawMessagingSenderId || '',
  appId: rawAppId || '',
};

// 【フェイルセーフ】初期化の重複防止と安全なインスタンス生成
let appInstance: FirebaseApp;

if (getApps().length > 0) {
  appInstance = getApp();
} else if (isFirebaseConfigured) {
  appInstance = initializeApp(firebaseConfig);
} else {
  // 環境変数未設定時のフォールバック用ダミー初期化（即時クラッシュを防止）
  appInstance = initializeApp(
    {
      apiKey: 'dummy-api-key-for-initialization-safety',
      projectId: 'dummy-project-id',
    },
    'SAFE_FALLBACK_APP',
  );
}

export const app: FirebaseApp = appInstance;
export const db: Firestore = getFirestore(app);
export const auth: Auth = getAuth(app);

/**
 * 【フールプルーフ ＆ フェイルセーフ】
 * Firestore が正常に利用可能か判定するユーザー定義型ガード
 */
export function isFirestoreAvailable(
  instance: Firestore | null | undefined,
): instance is Firestore {
  return isFirebaseConfigured && Boolean(instance);
}

/**
 * 【フェイルセーフ】
 * ブラウザかつFCM対応環境でのみMessagingインスタンスを解決する非同期プロバイダ
 */
export const getMessagingInstance = async (): Promise<Messaging | null> => {
  if (typeof window === 'undefined' || !isFirebaseConfigured) {
    return null;
  }

  try {
    const supported = await isSupported();
    if (supported) {
      return getMessaging(app);
    }
    console.warn(
      '【FCM非対応】ご利用のブラウザはFirebase Cloud Messagingをサポートしていません。',
    );
    return null;
  } catch (error: unknown) {
    console.error(
      '【FCM初期化エラー】Messagingインスタンスの取得に失敗しました:',
      error,
    );
    return null;
  }
};
