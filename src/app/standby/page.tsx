/**
 * 【参加選手専用 呼出通知事前登録・待機ページ】
 * パス: /standby
 *
 * 役割:
 * - 参加選手が大会当日または事前準備時に各自のスマートフォンでアクセスする専用ページ。
 * - 白系統（ライトテーマ）デザインに統一。
 * - 登録済み選手の中から自身を選択し、ブラウザ通知（FCM）を許可することで、
 *   競技進行（2立前）に連動した呼出プッシュ通知の受信待機状態を確立する。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 画面上部に「現在の通知許可状態」をバッジ表示し、ブロック時はブラウザ設定解除手順を明示。
 * - 選手選択コンポーネント（TeamSelectForm）により、未選択時の送信をUIおよびロジックで遮断。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - ブラウザAPI（Notification / serviceWorker）の取得に useSyncExternalStore を採用し、
 *   SSR時とCSR時のハイドレーション整合性を維持しつつカスケードレンダリング（set-state-in-effect）を排除。
 * - 非対応ブラウザやアプリ内ブラウザ（LINE・Instagram等）への警告と標準ブラウザ利用の誘導。
 * - 通知拒否時でも画面上で進行状況を確認できるよう安全に縮退。
 */

'use client';

import React, { useSyncExternalStore } from 'react';
import { TeamSelectForm } from '@/components/shared/TeamSelectForm';
import {
  Bell,
  AlertTriangle,
  Info,
  Smartphone,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';

/**
 * 静的ストア用の空購読関数（参照安定化のためコンポーネント外に配置）
 */
const emptySubscribe = () => () => {};

/**
 * ブラウザのPush通知・ServiceWorker対応状況の判定スナップショット
 */
function checkBrowserSupport(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  return 'Notification' in window && 'serviceWorker' in navigator;
}

/**
 * 通知パーミッション取得スナップショット
 */
function getNotificationPermissionSnapshot(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'default';
  }
  return Notification.permission;
}

/**
 * 外部システム（navigator.permissions）変更購読関数
 */
function subscribeNotificationPermission(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let permissionStatus: PermissionStatus | null = null;
  if ('permissions' in navigator) {
    navigator.permissions
      .query({ name: 'notifications' as PermissionName })
      .then((status) => {
        permissionStatus = status;
        status.onchange = callback;
      })
      .catch(() => {});
  }

  return () => {
    if (permissionStatus) {
      permissionStatus.onchange = null;
    }
  };
}

export default function StandbyPage() {
  // ブラウザ対応状況の外部ストア購読（useEffect内の同期的setStateを回避）
  const isSupportedBrowser = useSyncExternalStore(
    emptySubscribe,
    checkBrowserSupport,
    () => true,
  );

  // 通知許可状態の外部ストア購読
  const notificationPermission = useSyncExternalStore(
    subscribeNotificationPermission,
    getNotificationPermissionSnapshot,
    () => 'default',
  );

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-900 pb-16">
      {/* 選手用モバイルヘッダー（白系統デザイン） */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200/80 shadow-xs">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center font-black text-white text-xs shadow-2xs">
              弓
            </div>
            <div>
              <h1 className="text-sm font-black tracking-tight leading-tight text-slate-900">
                第5回めんたいこ杯 呼出待機
              </h1>
              <p className="text-[10px] text-slate-500 font-medium">
                選手用プッシュ通知登録ポータル
              </p>
            </div>
          </div>

          {/* 通知権限ステータスバッジ */}
          <div className="flex items-center">
            {notificationPermission === 'granted' ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                通知受信可
              </span>
            ) : notificationPermission === 'denied' ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-50 text-red-800 border border-red-300 px-2 py-0.5 rounded-full">
                <AlertTriangle className="w-3 h-3 text-red-600" />
                通知拒否
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-50 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-full">
                <Bell className="w-3 h-3 text-amber-600" />
                未設定
              </span>
            )}
          </div>
        </div>
      </header>

      {/* メインコンテンツ領域 */}
      <div className="max-w-md mx-auto p-4 space-y-4">
        {/* 非対応ブラウザ向け警告表示（フェイルセーフ） */}
        {!isSupportedBrowser && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-xs text-red-900 space-y-2 shadow-2xs">
            <div className="flex items-center gap-2 font-bold text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>プッシュ通知非対応のブラウザです</span>
            </div>
            <p className="leading-relaxed text-[11px] text-red-800 font-medium">
              現在ご利用のブラウザまたはアプリ内ブラウザ（LINE・Instagram等）はWebプッシュ通知に対応していません。SafariまたはGoogle
              Chrome等の標準ブラウザで本URLを開き直してください。
            </p>
          </div>
        )}

        {/* 通知ブロック時のリカバリー案内（フールプルーフ） */}
        {notificationPermission === 'denied' && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 text-xs text-amber-950 space-y-2 shadow-2xs">
            <div className="flex items-center gap-2 font-bold text-amber-900">
              <Info className="w-4 h-4 shrink-0 text-amber-700" />
              <span>通知がブロックされています</span>
            </div>
            <p className="leading-relaxed text-[11px] text-amber-900 font-medium">
              ブラウザまたは端末設定により通知が「拒否」されています。大会進行の呼出通知を受け取るには、以下の手順で通知を許可してください:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-amber-950 font-medium pl-1">
              <li>
                ブラウザのアドレスバー左側の「鍵マーク（設定アイコン）」をタップ
              </li>
              <li>
                「権限」または「サイトの設定」から「通知」を【許可】に変更
              </li>
              <li>このページを再読み込みして再度選手登録を実行</li>
            </ol>
          </div>
        )}

        {/* 登録手順ガイド（白系統デザイン） */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h2 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-slate-600" />
              事前登録の手順（全3ステップ）
            </h2>
            <span className="text-[10px] text-slate-400 font-mono">
              当日待機用
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
            <div className="p-2.5 bg-slate-50 border border-slate-200/60 rounded-xl space-y-1">
              <div className="w-5 h-5 mx-auto rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-[10px]">
                1
              </div>
              <p className="font-bold text-slate-800 leading-tight">
                選手名を選択
              </p>
              <p className="text-[9px] text-slate-500">ゼッケンを確認</p>
            </div>

            <div className="p-2.5 bg-slate-50 border border-slate-200/60 rounded-xl space-y-1">
              <div className="w-5 h-5 mx-auto rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-[10px]">
                2
              </div>
              <p className="font-bold text-slate-800 leading-tight">
                通知を許可
              </p>
              <p className="text-[9px] text-slate-500">ダイアログで許可</p>
            </div>

            <div className="p-2.5 bg-slate-50 border border-slate-200/60 rounded-xl space-y-1">
              <div className="w-5 h-5 mx-auto rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-[10px]">
                3
              </div>
              <p className="font-bold text-emerald-800 leading-tight">
                待機完了
              </p>
              <p className="text-[9px] text-slate-500">2立前に自動呼出</p>
            </div>
          </div>
        </div>

        {/* 参加選手選択およびFCMトークン登録フォーム */}
        <section aria-label="選手選択と通知登録フォーム">
          <TeamSelectForm />
        </section>

        {/* 端末ごとの確認事項カード（フェイルセーフ情報提供） */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 text-[11px] text-slate-600 space-y-2.5 shadow-sm">
          <div className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
            <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
            確実に通知を受け取るための確認事項
          </div>

          <ul className="space-y-1.5 leading-relaxed pl-1">
            <li className="flex items-start gap-1.5">
              <span className="text-slate-400 font-black">•</span>
              <span>
                <strong>iPhone (iOS) の場合:</strong> iOS
                16.4以降対応。通知が許可できない場合は、画面下の「共有ボタン」から
                <strong>「ホーム画面に追加」</strong>
                を行ってから開いてください。
              </span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-slate-400 font-black">•</span>
              <span>
                <strong>画面スリープ時:</strong>{' '}
                ブラウザを閉じても、端末の画面がロックされていてもプッシュ通知は届きます。
              </span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-slate-400 font-black">•</span>
              <span>
                <strong>マナーモード:</strong>{' '}
                試合中のため音が出ない設定（バイブレーションまたはバナー表示）になっているかご確認ください。
              </span>
            </li>
          </ul>
        </div>

        {/* 大会本部クレジット */}
        <div className="text-center pt-2">
          <p className="text-[10px] text-slate-400 font-medium">
            第5回めんたいこ杯争奪弓道大会 運営事務局
          </p>
        </div>
      </div>
    </main>
  );
}
