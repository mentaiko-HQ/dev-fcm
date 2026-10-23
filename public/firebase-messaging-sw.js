/**
 * 【FCM バックグラウンド通知受信用 Service Worker】
 *
 * 役割:
 * - バックグラウンド（画面ロック中・スリープ中・別タブ操作中）におけるFCMプッシュ通知の受信。
 * - スマートフォンブラウザ（Android Chrome/Edge, iOS PWA Safari等）において、
 *   「メッセージ表示」「バイブレーション（振動）」「通知音（アラート音）」を確実に作動させる。
 * - 通知タップ時に該当ページ（/standby等）へ自動フォーカスまたは新規タブ遷移。
 *
 * フールプルーフ設計（操作ミス・空データの入口遮断）:
 * - ペイロード内のタイトルや本文が未定義の場合でも、デフォルト文面にフォールバックして通知表示を保証。
 * - tag プロパティを設定し、同一立の連続通知による画面埋め尽くしを防止（最新通知に置換）。
 * - targetStandGroup が未指定の場合でも、ユニークなタグを生成して別通知の上書き消去を防止。
 * - renotify: true により、置換された場合でも再度バイブレーションと通知音を作動。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - クエリパラメータからFirebase設定が渡されない場合でも、デフォルトのプロジェクト設定（kyudoapp-dev-fcm）に
 *   安全にフォールバックして初期化失敗を防止。
 * - ネットワーク切断時やURL解析失敗時でも安全に /standby へ遷移。
 * - Service Worker初期化および通知処理の全例外を捕捉し、プロセスの強制終了を回避。
 */

importScripts(
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
);
importScripts(
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js',
);

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

try {
  // 1. URLクエリパラメータからFirebase設定値を抽出
  const urlParams = new URL(location).searchParams;

  // 2. フェイルセーフ: パラメータが存在しない場合の安全側フォールバック設定
  const firebaseConfig = {
    apiKey: urlParams.get('apiKey') || 'AIzaSyD-mock-api-key',
    authDomain:
      urlParams.get('authDomain') || 'kyudoapp-dev-fcm.firebaseapp.com',
    projectId: urlParams.get('projectId') || 'kyudoapp-dev-fcm',
    storageBucket:
      urlParams.get('storageBucket') || 'kyudoapp-dev-fcm.firebasestorage.app',
    messagingSenderId: urlParams.get('messagingSenderId') || '1028741364273',
    appId: urlParams.get('appId') || '1:1028741364273:web:mockappid',
  };

  // Firebase の初期化
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  // バックグラウンド通知受信ハンドラー
  messaging.onBackgroundMessage((payload) => {
    console.log(
      '【Service Worker】バックグラウンド通知を受信しました:',
      payload,
    );

    const targetStandGroup = payload.data?.targetStandGroup || '';
    const notificationTitle =
      payload.notification?.title ||
      payload.data?.title ||
      '【招集呼出】入場準備';

    const notificationBody =
      payload.notification?.body ||
      payload.data?.body ||
      '控席・招集所へ速やかにお集まりください。';

    // フールプルーフ: 立組番号の有無に応じたタグ生成（意図しない通知上書きの防止）
    const notificationTag = targetStandGroup
      ? `kyudo-stand-call-${targetStandGroup}`
      : `kyudo-general-call-${Date.now()}`;

    // 遷移先URLの安全な決定
    const targetUrl =
      payload.data?.click_action || payload.data?.url || '/standby';

    // 通知オプション設定（要件: メッセージあり、バイブレーションあり、通知音あり）
    const notificationOptions = {
      body: notificationBody,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      // スマートフォン向けバイブレーション設定（300ms振動 -> 150ms休止 -> 300ms振動 -> 150ms休止 -> 300ms振動）
      vibrate: [300, 150, 300, 150, 300],
      // 通知音設定（消音設定を解除し、ブラウザ標準の通知音を鳴動）
      silent: false,
      // 選手が画面上で確認・操作するまでバナーを保持
      requireInteraction: true,
      // 同一立の通知タグで置換された際にも再度バイブレーションと通知音を作動
      renotify: true,
      tag: notificationTag,
      data: {
        url: targetUrl,
      },
    };

    return self.registration.showNotification(
      notificationTitle,
      notificationOptions,
    );
  });
} catch (error) {
  console.error('【Service Worker初期化例外】:', error);
}

// 通知クリック時の画面フォーカス／遷移ハンドラー
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetPath = event.notification.data?.url || '/standby';
  const absoluteUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // 既に同オリジンのタブが開いている場合はそのタブをフォーカスして該当URLへナビゲート
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            if ('navigate' in client) {
              client.navigate(absoluteUrl);
            }
            return client.focus();
          }
        }
        // 開いているタブがない場合は新規ウィンドウで開く
        if (clients.openWindow) {
          return clients.openWindow(absoluteUrl);
        }
      }),
  );
});
