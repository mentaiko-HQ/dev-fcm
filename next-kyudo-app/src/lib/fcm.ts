import { getToken, onMessage, MessagePayload } from "firebase/messaging";
import { messaging, isFirebaseConfigured } from "./firebase";

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "";

/**
 * Web Audio APIを利用したチャイム音再生関数（フォアグラウンド通知用フェイルセーフ）
 * 端末やブラウザが消音設定でない限り、確実に音で招集を知らせる
 */
export function playNotificationSound(): void {
  try {
    if (typeof window === "undefined") return;

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const audioCtx = new AudioContextClass();

    // 和音チャイム（880Hz -> 440Hz: 注意喚起音）の生成
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // ラ(A5)
    osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.6); // ラ(A4)

    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (soundError) {
    console.warn("【通知警告】Web Audio API再生失敗（ユーザー未操作または未サポート）:", soundError);
  }
}

/**
 * 端末バイブレーション直接実行関数（フォアグラウンド通知用）
 */
export function triggerDeviceVibration(pattern: number[] = [300, 100, 300, 100, 300]): void {
  try {
    if (typeof window !== "undefined" && "navigator" in window && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch (vibError) {
    console.warn("【通知警告】バイブレーション実行失敗:", vibError);
  }
}

/**
 * FCMトークンを安全に取得する関数
 * フールプルーフ / フェイルセーフ: 権限状態の検証、Service Workerアクティブ化待機、エラー時のフォールバック
 */
export async function requestFcmToken(): Promise<string | null> {
  try {
    if (!isFirebaseConfigured || !messaging) {
      console.warn("【通知警告】Firebase設定が未完了のためFCMトークン取得をスキップします。");
      return null;
    }

    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      !("serviceWorker" in navigator)
    ) {
      console.warn("【通知警告】このブラウザはWebプッシュ通知またはService Workerをサポートしていません。");
      return null;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("【通知警告】通知の許可が得られませんでした。現在の権限:", permission);
      return null;
    }

    await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const activeRegistration = await navigator.serviceWorker.ready;

    const currentToken = await getToken(messaging, {
      vapidKey: VAPID_KEY || undefined,
      serviceWorkerRegistration: activeRegistration,
    });

    if (currentToken) {
      console.log("【FCM】トークン取得成功:", currentToken);
      return currentToken;
    } else {
      console.warn("【通知警告】トークンが生成されませんでした。");
      return null;
    }
  } catch (error: unknown) {
    const errorDetail =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : String(error);

    console.error("【エラーログ】FCMトークンの取得処理中に例外が発生しました:", errorDetail);
    return null;
  }
}

/**
 * フォアグラウンド受信リスナーを設定する関数
 * フォアグラウンド受信時に自動で音再生とバイブレーションをトリガー
 */
export function setupForegroundMessageListener(
  onMessageReceived: (payload: MessagePayload) => void
): () => void {
  if (!isFirebaseConfigured || !messaging) {
    return () => {};
  }

  try {
    const unsubscribe = onMessage(messaging, (payload) => {
      console.log("【FCM】フォアグラウンド通知を受信しました:", payload);

      // 音と振動の多層発火
      playNotificationSound();
      triggerDeviceVibration([300, 100, 300, 100, 300]);

      try {
        onMessageReceived(payload);
      } catch (callbackError) {
        console.error("【エラーログ】通知コールバック実行中にエラーが発生しました:", callbackError);
      }
    });

    return unsubscribe;
  } catch (error) {
    console.error("【エラーログ】フォアグラウンドリスナーの設定に失敗しました:", error);
    return () => {};
  }
}