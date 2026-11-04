/**
 * 【FCM バックグラウンド通知受信 ＆ タップ遷移制御 Service Worker】
 *
 * 役割:
 * - スマートフォンがスリープ中またはブラウザがバックグラウンドにある状態でFCM通知を受信・表示。
 * - 通知バナーをタップした際、指定された遷移先（/standby または /results）へ確実にナビゲートする。
 *
 * フールプルーフ設計:
 * - 既に同一オリジンのタブが開いている場合は新規タブを乱立させず、既存タブをフォーカスして遷移させる。
 *
 * フェイルセーフ設計:
 * - ペイロード欠損時でもデフォルトのタイトル・遷移先 (/standby) へ安全にフォールバック。
 */

self.addEventListener('push', function (event) {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    // browserが自動でnotificationフィールドを表示する場合は二重表示を避けるためスキップ
    if (payload.notification) {
      return;
    }

    const data = payload.data || {};
    const title = data.title || '【招集呼出】第5回めんたいこ杯';
    const options = {
      body: data.body || '出番が近づいています。招集状況を確認してください。',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      vibrate: [300, 150, 300, 150, 300],
      requireInteraction: true,
      data: {
        url: data.click_action || data.url || '/standby',
      },
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    console.error('【SW Push解析エラー】:', err);
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const rawData = event.notification.data || {};
  const fcmLink =
    rawData.url ||
    rawData.click_action ||
    (rawData.FCM_MSG &&
      rawData.FCM_MSG.notification &&
      rawData.FCM_MSG.notification.click_action) ||
    '/standby';

  const targetUrl = new URL(fcmLink, self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (
            client.url.startsWith(self.location.origin) &&
            'focus' in client
          ) {
            client.focus();
            if ('navigate' in client) {
              return client.navigate(targetUrl);
            }
            return;
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
      .catch(function (err) {
        console.error('【SW 通知クリック遷移エラー】:', err);
      }),
  );
});
