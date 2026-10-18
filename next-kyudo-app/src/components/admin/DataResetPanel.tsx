/**
 * 【大会データ初期化・リセット管理パネルコンポーネント】
 *
 * 役割:
 * 1. 参加者データの完全削除（entries コレクションの全ドキュメント削除）
 * 2. 入力済み成績データのみの削除（選手属性は保持し、スコア・フラグ・順位のみ初期化）
 *    ※ 初期化対象: スコア配列, totalHits, enkinRank, finalRank, isHayaHit, isSokuchu, isPerfect
 *
 * フールプルーフ設計（操作ミス・二重実行・未認証実行の入口遮断）:
 * - 実行直前に Firebase Auth の認証状態（auth.currentUser）を検証。未認証の場合は処理を中断し、Firestore への拒否リクエスト送信を防止。
 * - 確認キーワード入力の強制（全削除時は「全削除」、成績リセット時は「リセット」の完全一致でボタン活性化）。
 * - 実行中のボタン無効化（disabled）およびローディングスピナー表示による重複実行の防止。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - getIdToken(true) による認証トークンの強制リフレッシュを行い、失効トークンによる権限エラーを防止。
 * - Firestore writeBatch の500件上限を考慮し、400件単位の安全なチャンク分割バッチコミットを実行。
 * - エラー発生時でもコンポーネントのクラッシュを防ぎ、エラーコードと詳細メッセージを画面に表示。
 */

'use client';

import React, { useState } from 'react';
import {
  collection,
  getDocs,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import {
  db,
  auth,
  isFirebaseConfigured,
  isFirestoreAvailable,
} from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  ShieldAlert,
} from 'lucide-react';

type ResetMode = 'NONE' | 'DELETE_ALL_PARTICIPANTS' | 'RESET_SCORES_ONLY';

const BATCH_CHUNK_SIZE = 400;

export function DataResetPanel() {
  const [modalMode, setModalMode] = useState<ResetMode>('NONE');
  const [confirmationInput, setConfirmationInput] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  /**
   * モーダルを安全に閉じるハンドラー
   */
  const handleCloseModal = () => {
    if (isProcessing) return;
    setModalMode('NONE');
    setConfirmationInput('');
  };

  /**
   * 【フールプルーフ】認証セッションの有効性を確認し、トークンを最新化する
   */
  const verifyAuthSession = async (): Promise<boolean> => {
    if (!auth || !auth.currentUser) {
      setErrorMessage(
        '運営アカウントでログインしていません。/admin/login よりログインしてください。',
      );
      return false;
    }

    try {
      // 最新のIDトークンを強制取得して認証セッションを確定
      await auth.currentUser.getIdToken(true);
      return true;
    } catch (tokenErr: unknown) {
      console.error('【認証トークン更新エラー】:', tokenErr);
      setErrorMessage(
        '認証セッションの確認に失敗しました。再ログインしてください。',
      );
      return false;
    }
  };

  /**
   * 1. 参加者データをすべて削除
   */
  const executeDeleteAllParticipants = async () => {
    if (confirmationInput !== '全削除') return;

    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setErrorMessage('Firestoreデータベースに接続されていません。');
      return;
    }

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('');

    // 認証セッション検証（フールプルーフ）
    const isAuthed = await verifyAuthSession();
    if (!isAuthed) {
      setIsProcessing(false);
      return;
    }

    try {
      const entriesRef = collection(db, 'entries');
      const snapshot = await getDocs(entriesRef);

      if (snapshot.empty) {
        setStatusMessage('削除対象の参加者データは存在しませんでした。');
        setIsProcessing(false);
        handleCloseModal();
        return;
      }

      const totalCount = snapshot.size;
      const docs = snapshot.docs;

      // 400件単位でチャンク分割してバッチ削除を実行（フェイルセーフ）
      for (let i = 0; i < docs.length; i += BATCH_CHUNK_SIZE) {
        const chunk = docs.slice(i, i + BATCH_CHUNK_SIZE);
        const batch = writeBatch(db);

        chunk.forEach((docSnap) => {
          batch.delete(docSnap.ref);
        });

        await batch.commit();
      }

      setStatusMessage(
        `全 ${totalCount} 名の参加者データを完全に削除しました。`,
      );
      handleCloseModal();
    } catch (err: unknown) {
      console.error('【参加者全削除エラー】詳細:', err);
      const detail =
        err instanceof Error ? err.message : '通信環境を確認してください。';
      setErrorMessage(`参加者データの削除に失敗しました: ${detail}`);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * 2. 成績データのみリセット
   */
  const executeResetScoresOnly = async () => {
    if (confirmationInput !== 'リセット') return;

    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setErrorMessage('Firestoreデータベースに接続されていません。');
      return;
    }

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('');

    // 認証セッション検証（フールプルーフ）
    const isAuthed = await verifyAuthSession();
    if (!isAuthed) {
      setIsProcessing(false);
      return;
    }

    try {
      const entriesRef = collection(db, 'entries');
      const snapshot = await getDocs(entriesRef);

      if (snapshot.empty) {
        setStatusMessage('リセット対象の参加者データが存在しません。');
        setIsProcessing(false);
        handleCloseModal();
        return;
      }

      const totalCount = snapshot.size;
      const docs = snapshot.docs;

      // 400件単位でチャンク分割してスコア・賞フラグ関連フィールドのみ初期化（フェイルセーフ）
      for (let i = 0; i < docs.length; i += BATCH_CHUNK_SIZE) {
        const chunk = docs.slice(i, i + BATCH_CHUNK_SIZE);
        const batch = writeBatch(db);

        chunk.forEach((docSnap) => {
          batch.update(docSnap.ref, {
            stand1_arrows: [],
            stand2_arrows: [],
            stand3_arrows: [],
            totalHits: 0,
            isHayaHit: false, // 甲矢的中賞フラグ初期化
            isSokuchu: false, // 一手束中賞フラグ初期化
            isPerfect: false, // 四矢皆中賞フラグ初期化
            enkinRank: null,
            finalRank: null,
            updatedAt: serverTimestamp(),
          });
        });

        await batch.commit();
      }

      setStatusMessage(
        `全 ${totalCount} 名の成績・賞データ（スコア、甲矢・束中・皆中フラグ）を初期化しました（選手名・立順情報は保持されています）。`,
      );
      handleCloseModal();
    } catch (err: unknown) {
      console.error('【成績データ初期化エラー】詳細:', err);
      const detail =
        err instanceof Error ? err.message : '通信環境を確認してください。';
      setErrorMessage(`成績データのリセットに失敗しました: ${detail}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 操作ボタングループ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* 成績データのみ削除ボタン */}
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg flex flex-col justify-between gap-3">
          <div className="space-y-1">
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4 text-amber-500" />
              入力された成績データのみ削除
            </span>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              登録された選手名・立順配置・受付状況は残し、第1立〜第3立の的中記録（〇✕）、通算的中数、および各種賞のフラグをすべて初期化します。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setConfirmationInput('');
              setErrorMessage('');
              setStatusMessage('');
              setModalMode('RESET_SCORES_ONLY');
            }}
            className="w-full text-xs font-bold border-amber-500/50 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            成績データのみリセット
          </Button>
        </div>

        {/* 参加者データ全削除ボタン */}
        <div className="p-3.5 bg-slate-900 border border-red-950/80 rounded-lg flex flex-col justify-between gap-3">
          <div className="space-y-1">
            <span className="text-xs font-bold text-red-400 flex items-center gap-1.5">
              <Trash2 className="w-4 h-4 text-red-500" />
              参加者データをすべて削除
            </span>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              登録されている全選手のデータ（名簿・立順・スコア・受付記録）を完全に消去します。本番大会の終了後やデータ再取込前に使用します。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setConfirmationInput('');
              setErrorMessage('');
              setStatusMessage('');
              setModalMode('DELETE_ALL_PARTICIPANTS');
            }}
            className="w-full text-xs font-bold border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            全参加者データを完全消去
          </Button>
        </div>
      </div>

      {/* ステータス・エラー表示 */}
      {statusMessage && (
        <div className="flex items-center gap-2 p-2.5 bg-emerald-950/50 border border-emerald-800 rounded-lg text-emerald-300 text-xs font-bold">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center gap-2 p-2.5 bg-red-950/50 border border-red-800 rounded-lg text-red-300 text-xs font-bold">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* フールプルーフ確認モーダル */}
      {modalMode !== 'NONE' && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl space-y-4">
            {/* モーダルヘッダー */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-red-500">
                <ShieldAlert className="w-5 h-5 text-red-500" />
                <h3 className="text-sm font-bold text-white">
                  {modalMode === 'DELETE_ALL_PARTICIPANTS'
                    ? '【警告】参加者データの完全削除'
                    : '【確認】成績データの一括初期化'}
                </h3>
              </div>
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleCloseModal}
                className="text-slate-400 hover:text-white disabled:opacity-30"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* モーダル本文・警告文 */}
            <div className="space-y-3 text-xs leading-relaxed text-slate-300">
              {modalMode === 'DELETE_ALL_PARTICIPANTS' ? (
                <div className="p-3 bg-red-950/40 border border-red-900 rounded-lg space-y-1.5 text-red-200">
                  <p className="font-bold flex items-center gap-1 text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    この操作は元に戻せません
                  </p>
                  <p className="text-[11px] text-red-300">
                    Firestore上の全参加選手ドキュメントが完全に消去されます。再度名簿を取り込む必要があります。
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-amber-950/40 border border-amber-900 rounded-lg space-y-1.5 text-amber-200">
                  <p className="font-bold flex items-center gap-1 text-amber-400">
                    <AlertTriangle className="w-4 h-4" />
                    的中記録および各種賞フラグがすべてリセットされます
                  </p>
                  <p className="text-[11px] text-amber-300">
                    全選手の第1立〜第3立のスコアが消去され、甲矢的中・束中・皆中フラグも初期化されます（0射0中に戻ります）。選手一覧や立順設定は維持されます。
                  </p>
                </div>
              )}

              {/* キーワード入力欄 */}
              <div className="space-y-1.5 pt-1">
                <label className="block text-slate-400 font-bold text-[11px]">
                  続行するには確認のため「
                  <strong className="text-white font-mono">
                    {modalMode === 'DELETE_ALL_PARTICIPANTS'
                      ? '全削除'
                      : 'リセット'}
                  </strong>
                  」と入力してください:
                </label>
                <input
                  type="text"
                  disabled={isProcessing}
                  value={confirmationInput}
                  onChange={(e) => setConfirmationInput(e.target.value.trim())}
                  placeholder={
                    modalMode === 'DELETE_ALL_PARTICIPANTS'
                      ? '全削除'
                      : 'リセット'
                  }
                  className="w-full p-2.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white font-bold outline-none focus:border-red-500"
                />
              </div>
            </div>

            {/* モーダルフッター */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isProcessing}
                onClick={handleCloseModal}
                className="text-xs bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
              >
                キャンセル
              </Button>

              {modalMode === 'DELETE_ALL_PARTICIPANTS' ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={isProcessing || confirmationInput !== '全削除'}
                  onClick={executeDeleteAllParticipants}
                  className="text-xs bg-red-600 hover:bg-red-700 text-white font-bold disabled:opacity-40"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                      全削除を実行中...
                    </>
                  ) : (
                    '全参加者を完全に削除する'
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={isProcessing || confirmationInput !== 'リセット'}
                  onClick={executeResetScoresOnly}
                  className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-bold disabled:opacity-40"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                      初期化を実行中...
                    </>
                  ) : (
                    '成績データをリセットする'
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
