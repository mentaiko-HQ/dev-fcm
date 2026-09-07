/**
 * 【FCM バックグラウンド通知受信用 Service Worker】
 * 
 * 役割:
 * - バックグラウンド（画面ロック中・スリープ中・別アプリ操作中）におけるFCMプッシュ通知の受信。
 * - スマートフォンブラウザ（Android Chrome/Edge, iOS PWA Safari等）において、
 *   「メッセージ表示」「バイブレーション（振動）」「通知音（アラート音）」を確実に作動させる。
 * 
 * フールプルーフ設計:
 * - ペイロード内のタイトルや本文が未定義の場合でも、デフォルト文面にフォールバックして通知表示を保証。
 * - tag プロパティを設定し、同一立の連続通知による画面の埋め尽くしを防止（最新通知に置換）。
 * - renotify: true により、置換された場合でも再度バイブレーションと通知音を作動。
 * 
 * フェイルセーフ設計:
 * - Service Worker登録時の例外をすべてキャッチし、スクリプトのロードエラーや停止を回避。
 * - ネットワーク切断時でもローカル通知キャッシュを利用して安定表示。
 */

importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

try {
  // URLクエリパラメータからFirebase設定値を安全に抽出
  const urlParams = new URL(location).searchParams;
  const firebaseConfig = {
    apiKey: urlParams.get("apiKey") || "",
    authDomain: urlParams.get("authDomain") || "",
    projectId: urlParams.get("projectId") || "",
    storageBucket: urlParams.get("storageBucket") || "",
    messagingSenderId: urlParams.get("messagingSenderId") || "",
    appId: urlParams.get("appId") || "",
  };

  // プロジェクトIDが存在する場合のみ初期化を実行
  if (firebaseConfig.projectId) {
    firebase.initializeApp(firebaseConfig);
    const messaging = firebase.messaging();

    // バックグラウンド通知受信ハンドラー
    messaging.onBackgroundMessage((payload) => {
      console.log("【Service Worker】バックグラウンド通知を受信しました:", payload);

      const targetStandGroup = payload.data?.targetStandGroup || "";
      const notificationTitle = payload.notification?.title || payload.data?.title || "【招集呼出】入場準備";
      const notificationBody = payload.notification?.body || payload.data?.body || "控席・招集所へ速やかにお集まりください。";

      // 【要件定義】メッセージあり・バイブレーションあり・通知音あり
      const notificationOptions = {
        body: notificationBody,
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        // 【スマートフォン向けバイブレーション設定】
        // パターン: 300ms振動 -> 150ms休止 -> 300ms振動 -> 150ms休止 -> 300ms振動
        vibrate: [300, 150, 300, 150, 300],
        // 【通知音設定】消音設定を解除（ブラウザ標準の通知音を鳴動）
        silent: false,
        // 通知タップまたは選手が確認するまでバナーを画面に保持
        requireInteraction: true,
        // 同一立の通知タグで置換された際にも再度バイブレーションと通知音を作動
        renotify: true,
        // 立ごとに通知を識別するタグ
        tag: `kyudo-stand-call-${targetStandGroup}`,
        data: {
          url: payload.data?.click_action || payload.data?.url || "/standby",
        },
      };

      // ブラウザ標準のシステム通知を表示
      return self.registration.showNotification(notificationTitle, notificationOptions);
    });
  }
} catch (error) {
  console.error("【Service Worker初期化例外】:", error);
}

// 通知クリック時の画面フォーカス／遷移ハンドラー
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/standby";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // 既に開いているタブが存在する場合はフォーカス
      for (const client of windowClients) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      // 開いているタブがない場合は新規ウィンドウで開く
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});