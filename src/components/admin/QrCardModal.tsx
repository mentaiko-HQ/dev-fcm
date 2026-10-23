/**
 * 【選手情報一体型 QRカードプレビュー＆配布モーダルコンポーネント】
 *
 * 役割:
 * - 選択された選手のQRカード画像をクライアントサイドで自動合成・プレビュー表示。
 * - 申込担当者がスマートフォンやPCから「LINEで送信」「画像ダウンロード」「案内テキストコピー」をワンタップで実行可能にする。
 *
 * フールプルーフ設計（操作ミス・取り違え送信の入口遮断）:
 * - 午前または午後の立ち順が未設定（null）の場合、上部に警告バナーを表示し、
 *   未確定QRの誤配布を抑止。
 * - 生成中判定（isGenerating）を state ではなく `Boolean(!result && !errorMessage)` の導出ステート（Derived State）として算出し、
 *   React 19 / ESLint の `react-hooks/set-state-in-effect`（Effect内での同期setStateによるカスケードレンダリング）を構造的に解消。
 * - 対象選手の切り替えやモーダル開閉時のステートリセットは、Effect内ではなくレンダー中の前ステート照合パターンで実行。
 *
 * フェイルセーフ設計（端末機能・通信環境の安全縮退）:
 * - Web Share API（画像ファイル共有）に対応している場合は優先して端末の共有シート（LINE等）を起動。
 * - Web Share API が画像共有非対応またはPCブラウザの場合は、自動的に「LINE URLスキーム（テキスト共有）」
 *   または「画像ダウンロード＆リンクコピー」へ安全にフォールバック。
 * - ユーザーが共有シートをキャンセルした場合（AbortError）はエラー通知を行わず静かに閉じる。
 * - 未使用インポート（ExternalLink）を排除し、Tailwind CSS クラスをカノニカル形式（min-h-95, max-w-70）へ適合。
 * - クライアントサイド動的DataURL画像描画箇所に対して ESLint 抑止コメントを付与。
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Participant } from '@/types';
import {
  generateQrCardImage,
  QrCardGenerationResult,
} from '@/lib/qrCardGenerator';
import { Button } from '@/components/ui/button';
import {
  X,
  Download,
  Share2,
  Copy,
  CheckCircle2,
  AlertCircle,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

export interface QrCardModalProps {
  participant: Participant | null;
  isOpen: boolean;
  onClose: () => void;
  tournamentTitle?: string;
}

export function QrCardModal({
  participant,
  isOpen,
  onClose,
  tournamentTitle = '第5回めんたいこ杯争奪弓道大会',
}: QrCardModalProps) {
  const [result, setResult] = useState<QrCardGenerationResult | null>(null);
  const [isSharing, setIsSharing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // 前回の対象選手IDを保持し、対象選手変更時のステートリセットをレンダー中に同期実行（set-state-in-effect 回避）
  const [prevParticipantId, setPrevParticipantId] = useState<string | null>(
    null,
  );
  const currentParticipantId = isOpen && participant ? participant.id : null;

  if (currentParticipantId !== prevParticipantId) {
    setPrevParticipantId(currentParticipantId);
    setResult(null);
    setErrorMessage('');
    setStatusMessage('');
  }

  // 導出ステート（Derived State）: 生成完了またはエラー発生前を生成中として判定
  const isGenerating = Boolean(
    isOpen && participant && !result && !errorMessage,
  );

  // 立ち順の確定状態検証
  const isFullyAssigned = Boolean(
    participant &&
    participant.standAssignments[1]?.standGroup !== null &&
    participant.standAssignments[1]?.standOrder !== null &&
    participant.standAssignments[2]?.standGroup !== null &&
    participant.standAssignments[2]?.standOrder !== null,
  );

  useEffect(() => {
    if (!isOpen || !participant) {
      return;
    }

    let isMounted = true;

    // QR埋め込みペイロードの作成
    const qrPayload = JSON.stringify({
      id: participant.id,
      bib: participant.bibNumber,
      name: participant.name,
      org: participant.organization || '無所属',
      s1g: participant.standAssignments[1]?.standGroup ?? null,
      s1o: participant.standAssignments[1]?.standOrder ?? null,
      s2g: participant.standAssignments[2]?.standGroup ?? null,
      s2o: participant.standAssignments[2]?.standOrder ?? null,
    });

    generateQrCardImage(participant, {
      tournamentTitle,
      checkinPayload: qrPayload,
    })
      .then((res) => {
        if (isMounted) {
          setResult(res);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('【QRカード生成失敗】:', err);
          setErrorMessage('QRカード画像の生成に失敗しました。');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, participant, tournamentTitle]);

  if (!isOpen || !participant) {
    return null;
  }

  const shareText = `【${tournamentTitle}】\n${participant.name} 選手の受付用QRコードを発行しました。\nゼッケンNo.${participant.bibNumber}\n午前立順: 第${participant.standAssignments[1]?.standGroup || '-'}組-${participant.standAssignments[1]?.standOrder || '-'}番\n午後立順: 第${participant.standAssignments[2]?.standGroup || '-'}組-${participant.standAssignments[2]?.standOrder || '-'}番\n大会当日は添付のQRコード画像を受付端末にご提示ください。`;

  /**
   * 【LINE / Web Share API 共有ハンドラー】
   */
  const handleShareToLine = async () => {
    if (!result) return;
    setIsSharing(true);
    setErrorMessage('');

    try {
      // 1. Web Share API による画像ファイル共有の試行（スマートフォン向け最優先経路）
      if (
        typeof navigator !== 'undefined' &&
        navigator.share &&
        navigator.canShare &&
        navigator.canShare({ files: [result.file] })
      ) {
        await navigator.share({
          title: `${tournamentTitle} 受付QRコード - ${participant.name} 選手`,
          text: shareText,
          files: [result.file],
        });
        setStatusMessage('共有メニューを起動しました。');
        setTimeout(() => setStatusMessage(''), 3000);
        setIsSharing(false);
        return;
      }

      // 2. フェイルセーフ: LINE URLスキーム（テキスト共有）へのフォールバック
      const lineUrl = `https://line.me/R/share?text=${encodeURIComponent(shareText)}`;
      window.open(lineUrl, '_blank', 'noopener,noreferrer');

      setStatusMessage(
        'LINE共有画面を別タブで開きました。画像は下部ボタンより保存して送信してください。',
      );
      setTimeout(() => setStatusMessage(''), 4000);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setIsSharing(false);
        return;
      }
      console.error('【共有処理例外】:', err);
      setErrorMessage(
        '共有シートの起動に失敗しました。画像ダウンロードまたはテキストコピーをご利用ください。',
      );
    } finally {
      setIsSharing(false);
    }
  };

  /**
   * 【画像ダウンロードハンドラー】
   */
  const handleDownloadImage = () => {
    if (!result) return;

    try {
      const link = document.createElement('a');
      link.href = result.dataUrl;
      link.download = `qrcard_bib_${participant.bibNumber}_${participant.name}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setStatusMessage('QRカード画像を端末に保存しました。');
      setTimeout(() => setStatusMessage(''), 2500);
    } catch (err) {
      console.error('【ダウンロード失敗】:', err);
      setErrorMessage('画像の保存処理に失敗しました。');
    }
  };

  /**
   * 【案内文テキスト・クリップボードコピーハンドラー】
   */
  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setStatusMessage('案内テキストをクリップボードにコピーしました。');
      setTimeout(() => setStatusMessage(''), 2500);
    } catch (err) {
      console.error('【クリップボードコピー失敗】:', err);
      setErrorMessage('クリップボードへのコピーに失敗しました。');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* モーダルヘッダー */}
        <div className="flex items-center justify-between p-4 px-6 border-b border-slate-100 bg-slate-50/80">
          <div>
            <span className="text-[10px] font-bold bg-slate-900 text-white px-2 py-0.5 rounded-full">
              選手情報一体型
            </span>
            <h3 className="text-base font-black text-slate-900 pt-0.5">
              受付用 QRカード発行・配布
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* モーダル本文 */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* フールプルーフ: 立順未割当警告 */}
          {!isFullyAssigned && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-bold text-amber-950">立ち順が未確定です</p>
                <p className="text-[11px] text-amber-800">
                  ※立ち順（午前・午後）が空欄のまま配布すると選手が混乱する原因となります。立ち順を割り当てて保存した後に配布することを推奨します。
                </p>
              </div>
            </div>
          )}

          {/* ステータスメッセージ */}
          {statusMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* カードプレビュー領域 */}
          <div className="flex flex-col items-center justify-center bg-slate-100 p-4 rounded-xl border border-slate-200/80 min-h-95">
            {isGenerating ? (
              <div className="flex flex-col items-center gap-2 text-slate-500 text-xs font-bold">
                <Loader2 className="w-8 h-8 animate-spin text-slate-800" />
                <span>QRカード画像を合成中...</span>
              </div>
            ) : result ? (
              <div className="relative group max-w-70 sm:max-w-xs shadow-lg rounded-xl overflow-hidden border border-slate-200 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.dataUrl}
                  alt={`${participant.name} 選手 QRカード`}
                  className="w-full h-auto object-contain block"
                />
              </div>
            ) : (
              <div className="text-xs text-slate-400">
                プレビューを取得できませんでした。
              </div>
            )}
          </div>

          <p className="text-[11px] text-slate-500 text-center leading-relaxed">
            ※選手氏名・ゼッケン・立順が画像に焼き込まれているため、LINEで画像を送信しても誰のQRコードかが一目で判別できます。
          </p>
        </div>

        {/* モーダルアクションフッター */}
        <div className="p-4 px-6 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyText}
              className="text-xs font-bold border-slate-300 text-slate-700 hover:bg-white h-9"
            >
              <Copy className="w-3.5 h-3.5 mr-1" />
              案内文コピー
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!result || isGenerating}
              onClick={handleDownloadImage}
              className="text-xs font-bold border-slate-300 text-slate-700 hover:bg-white h-9"
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              画像保存 (PNG)
            </Button>
          </div>

          {/* LINE / ネイティブ共有ボタン */}
          <Button
            type="button"
            size="sm"
            disabled={!result || isGenerating || isSharing}
            onClick={handleShareToLine}
            className="bg-[#06C755] hover:bg-[#05B34C] text-white font-black text-xs h-9 px-4 rounded-xl shadow-xs transition-transform active:scale-95 disabled:opacity-40"
          >
            {isSharing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : (
              <Share2 className="w-3.5 h-3.5 mr-1.5 text-white" />
            )}
            LINE等で選手に送る
          </Button>
        </div>
      </div>
    </div>
  );
}
