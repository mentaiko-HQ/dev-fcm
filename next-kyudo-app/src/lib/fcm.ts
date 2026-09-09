/**
 * 【FCM トークン発行および通知権限管理モジュール】
 * 
 * フールプルーフ設計:
 * - VAPIDキー未設定の検知およびコンソールへの設定催促ログ出力。
 * - Notification API の対応状況、通知許可状態（granted, denied, default）に応じた厳密な分岐判定。
 * 
 * フェイルセーフ設計:
 * - ユーザーによる通知拒否（denied）や Service Worker 登録失敗時でも、例外をスローせず
 *   判定ステータスと null トークンを返却し、システム全体の処理停止を防止。
 */

import { getToken, Messaging } from "firebase/messaging";
import { getMessagingInstance } from "@/lib/firebase";

export interface FCMTokenResult {
  token: string | null;
  status: "granted" | "denied" | "unsupported" | "error";
  errorMessage?: string;
}

/**
 * ブラウザに通知権限を要求し、有効な FCM トークンを取得する関数
 */
export async function requestFCMToken(): Promise<FCMTokenResult> {
  // 1. クライアント環境および Notification API の対応検証（フールプルーフ）
  if (typeof window === "undefined" || !("Notification" in window)) {
    console.warn("【FCM警告】このブラウザはWebプッシュ通知に対応していません。");
    return {
      token: null,
      status: "unsupported",
      errorMessage: "ご利用のブラウザはプッシュ通知に対応していません。",
    };
  }

  // 2. VAPID公開鍵の存在検証（フールプルーフ）
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.error("【FCM設定エラー】NEXT_PUBLIC_FIREBASE_VAPID_KEY が設定されていません。");
    return {
      token: null,
      status: "error",
      errorMessage: "プッシュ通知用公開鍵が未設定です。",
    };
  }

  try {
    // 3. 通知権限のリクエスト
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("【FCM通知未許可】ユーザーにより通知が許可されませんでした。ステータス:", permission);
      return {
        token: null,
        status: "denied",
        errorMessage: "通知の受信が許可されていません。",
      };
    }

    // 4. Messaging インスタンスの取得（フェイルセーフ）
    const messaging: Messaging | null = await getMessagingInstance();
    if (!messaging) {
      console.error("【FCMエラー】Messaging機能の起動に失敗しました。");
      return {
        token: null,
        status: "unsupported",
        errorMessage: "Messaging機能の起動に失敗しました。",
      };
    }

    // 5. Service Worker の登録状況確認
    let serviceWorkerRegistration: ServiceWorkerRegistration | undefined;
    if ("serviceWorker" in navigator) {
      const swUrl = `/firebase-messaging-sw.js?projectId=${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}&messagingSenderId=${process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}&apiKey=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}&appId=${process.env.NEXT_PUBLIC_FIREBASE_APP_ID}`;
      serviceWorkerRegistration = await navigator.serviceWorker.register(swUrl);
      await navigator.serviceWorker.ready;
    }

    // 6. トークンの取得実行
    const currentToken = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration,
    });

    if (currentToken) {
      return { token: currentToken, status: "granted" };
    } else {
      console.warn("【FCM警告】利用可能なFCMトークンが生成されませんでした。");
      return {
        token: null,
        status: "error",
        errorMessage: "利用可能なFCMトークンが生成されませんでした。",
      };
    }
  } catch (error: unknown) {
    // 例外発生時もアプリをクラッシュさせずに安全にエラー情報を返却（フェイルセーフ）
    console.error("【FCMトークン取得例外】詳細ログ:", error);
    return {
      token: null,
      status: "error",
      errorMessage: error instanceof Error ? error.message : "トークン取得中に不明なエラーが発生しました。",
    };
  }
}