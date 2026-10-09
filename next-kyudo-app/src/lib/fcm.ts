/**
 * 【FCM トークン発行および通知権限管理モジュール】
 *
 * 役割:
 * - ブラウザの Web Notification 権限要求および FCM 登録トークンの発行。
 * - Service Worker (firebase-messaging-sw.js) の安全な登録と連携。
 * - 呼び出し元の仕様（トークン直接取得 / ステータスオブジェクト取得）の双方に対応する互換性提供。
 *
 * フールプルーフ設計（操作ミス・入力不備の入口遮断）:
 * - VAPIDキー未設定または空白値の検知とコンソールエラー出力。
 * - 環境変数読み込み時の .trim() による不要な空白・改行文字の自動除去。
 * - 既にユーザーが通知を「ブロック（denied）」している場合は無駄な権限プロンプト実行をバイパス。
 * - 既存コードの呼び出し互換性維持（requestFCMToken と requestFcmToken の両方をエクスポート）。
 *
 * フェイルセーフ設計（障害発生時の安全縮退）:
 * - SSR（サーバーサイドレンダリング）環境や非対応ブラウザで実行された場合でも例外を投げず安全に返却。
 * - Service Worker 登録失敗、ネットワーク切断、Firebase Messaging 起動失敗の全例外を捕捉し、
 *   システム全体の画面描画・操作を停止させない。
 */

import { getToken, Messaging } from 'firebase/messaging';
import { getMessagingInstance } from '@/lib/firebase';

export interface FCMTokenResult {
  token: string | null;
  status: 'granted' | 'denied' | 'unsupported' | 'error';
  errorMessage?: string;
}

/**
 * ブラウザに通知権限を要求し、詳細なステータスと共に FCM トークンを取得する関数
 */
export async function requestFCMToken(): Promise<FCMTokenResult> {
  // 1. クライアント環境および Notification API の対応検証（フールプルーフ）
  if (typeof window === 'undefined' || !('Notification' in window)) {
    console.warn(
      '【FCM警告】このブラウザはWebプッシュ通知に対応していません。',
    );
    return {
      token: null,
      status: 'unsupported',
      errorMessage: 'ご利用のブラウザはプッシュ通知に対応していません。',
    };
  }

  // 2. VAPID公開鍵の存在および文字列検証（フールプルーフ）
  const rawVapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  const vapidKey = rawVapidKey ? rawVapidKey.trim() : '';

  if (!vapidKey) {
    console.error(
      '【FCM設定エラー】NEXT_PUBLIC_FIREBASE_VAPID_KEY が設定されていないか空です。',
    );
    return {
      token: null,
      status: 'error',
      errorMessage: 'プッシュ通知用公開鍵（VAPID KEY）が未設定です。',
    };
  }

  try {
    // 3. 既存の通知権限の事前検証
    let permission: NotificationPermission = Notification.permission;

    if (permission === 'denied') {
      console.warn('【FCM通知拒否】ユーザーにより通知がブロックされています。');
      return {
        token: null,
        status: 'denied',
        errorMessage:
          'ブラウザ設定で通知がブロックされています。設定から解除してください。',
      };
    }

    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      console.warn(
        '【FCM通知未許可】通知が許可されませんでした。ステータス:',
        permission,
      );
      return {
        token: null,
        status: 'denied',
        errorMessage: '通知の受信が許可されませんでした。',
      };
    }

    // 4. Messaging インスタンスの安全な取得（フェイルセーフ）
    const messaging: Messaging | null = await getMessagingInstance();
    if (!messaging) {
      console.error(
        '【FCMエラー】Firebase Messaging機能の初期化・起動に失敗しました。',
      );
      return {
        token: null,
        status: 'unsupported',
        errorMessage: 'Messaging機能の起動に失敗しました。',
      };
    }

    // 5. Service Worker の登録および準備待機
    let serviceWorkerRegistration: ServiceWorkerRegistration | undefined;
    if ('serviceWorker' in navigator) {
      try {
        const projectId = (
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || ''
        ).trim();
        const senderId = (
          process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || ''
        ).trim();
        const apiKey = (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim();
        const appId = (process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '').trim();

        const swUrl = `/firebase-messaging-sw.js?projectId=${encodeURIComponent(projectId)}&messagingSenderId=${encodeURIComponent(senderId)}&apiKey=${encodeURIComponent(apiKey)}&appId=${encodeURIComponent(appId)}`;

        serviceWorkerRegistration =
          await navigator.serviceWorker.register(swUrl);
        await navigator.serviceWorker.ready;
      } catch (swError) {
        console.error(
          '【FCM警告】Service Workerの登録に失敗しました。デフォルトワーカーを試行します:',
          swError,
        );
        serviceWorkerRegistration = await navigator.serviceWorker.ready;
      }
    }

    // 6. FCM トークンの発行実行
    const currentToken = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration,
    });

    if (currentToken && currentToken.trim().length > 0) {
      return {
        token: currentToken.trim(),
        status: 'granted',
      };
    } else {
      console.warn(
        '【FCM警告】利用可能なFCMトークンが空または生成されませんでした。',
      );
      return {
        token: null,
        status: 'error',
        errorMessage: '利用可能なFCMトークンが生成されませんでした。',
      };
    }
  } catch (error: unknown) {
    // 例外発生時もアプリをクラッシュさせずに安全にエラー情報を返却（フェイルセーフ）
    console.error('【FCMトークン取得例外】詳細ログ:', error);
    return {
      token: null,
      status: 'error',
      errorMessage:
        error instanceof Error
          ? error.message
          : 'トークン取得中に不明なエラーが発生しました。',
    };
  }
}

/**
 * 【下位互換性ラッパー関数】
 * 呼び出し元がトークン文字列（string | null）を直接期待している既存実装を破壊しないためのエイリアス。
 */
export async function requestFcmToken(): Promise<string | null> {
  const result = await requestFCMToken();
  return result.token;
}
