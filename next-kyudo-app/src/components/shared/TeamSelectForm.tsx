'use client';

import React, { useState, useEffect } from 'react';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { requestFcmToken } from '@/lib/fcm';
import { Button } from '@/components/ui/button';

// チーム選択肢の型定義（フールプルーフ: 不正な構造の混入を防止）
interface TeamOption {
  id: string;
  name: string;
}

// サンプルデータ（大会運用時はFirestoreのteamsコレクションから取得可能）
const SAMPLE_TEAMS: TeamOption[] = [
  { id: 'team_01', name: '第一立（〇〇大学Aチーム）' },
  { id: 'team_02', name: '第二立（△△高校Bチーム）' },
  { id: 'team_03', name: '第三立（□□一般クラブ）' },
];

export function TeamSelectForm() {
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [currentRegisteredTeam, setCurrentRegisteredTeam] = useState<
    string | null
  >(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // フールプルーフ & フェイルセーフ:
  // useEffect内での同期的なsetState呼び出しによるESLintエラーを防ぐため、
  // useStateの遅延初期化（Lazy Initialization）を用いてlocalStorageから安全に端末固有IDを取得・生成する。
  const [localUserId] = useState<string>(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    try {
      let uid = localStorage.getItem('kyudo_device_uid');
      if (!uid) {
        uid = 'device_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('kyudo_device_uid', uid);
      }
      return uid;
    } catch (storageError) {
      // フェイルセーフ: プライベートブラウズ等でlocalStorageへのアクセスがブロックされた場合のフォールバック
      console.error(
        '【エラーログ】localStorageへのアクセスに失敗しました:',
        storageError,
      );
      return 'device_fallback_' + Math.random().toString(36).substring(2, 15);
    }
  });

  useEffect(() => {
    // 端末IDが存在しない場合（SSR時など）は実行しない
    if (!localUserId) return;

    let isMounted = true;

    // 既存の登録状況をFirestoreから取得し、画面に反映する（維持機能）
    const fetchExistingRegistration = async () => {
      try {
        const userDocRef = doc(db, 'users', localUserId);
        const snapshot = await getDoc(userDocRef);

        if (snapshot.exists() && isMounted) {
          const data = snapshot.data();
          if (
            data &&
            typeof data.selectedTeamId === 'string' &&
            data.selectedTeamId.length > 0
          ) {
            setCurrentRegisteredTeam(data.selectedTeamId);
            setSelectedTeamId(data.selectedTeamId);
          }
        }
      } catch (error) {
        // フェイルセーフ: 通信障害時もアプリをクラッシュさせずにエラーログを出力
        console.error(
          '【エラーログ】既存チーム情報の復元に失敗しました:',
          error,
        );
      }
    };

    fetchExistingRegistration();

    // クリーンアップ関数（アンマウント時の不要な状態更新を防止）
    return () => {
      isMounted = false;
    };
  }, [localUserId]);

  // チーム登録およびFCM通知設定処理
  const handleRegister = async () => {
    // フールプルーフ: 未選択状態での送信を早期ブロック
    if (!selectedTeamId) {
      setStatusMessage('チームを選択してください。');
      return;
    }

    setIsProcessing(true);
    setStatusMessage('通知設定および登録を処理中...');

    try {
      // FCMトークンを取得
      const token = await requestFcmToken();

      // Firestoreにユーザー情報・チームID・FCMトークンを上書き保存
      const userDocRef = doc(db, 'users', localUserId);
      await setDoc(
        userDocRef,
        {
          userId: localUserId,
          selectedTeamId: selectedTeamId,
          fcmToken: token || null,
          updatedAt: Date.now(),
        },
        { merge: true }, // 既存フィールドを維持しつつマージ更新
      );

      setCurrentRegisteredTeam(selectedTeamId);
      setStatusMessage('登録が完了しました。出番の2立前に招集通知が届きます。');
    } catch (error) {
      // フェイルセーフ: エラーログを収集し、ユーザーへ安全なフィードバックを提示
      console.error(
        '【エラーログ】チーム登録・通知設定中にエラーが発生しました:',
        error,
      );
      setStatusMessage('登録処理に失敗しました。通信環境をご確認ください。');
    } finally {
      setIsProcessing(false);
    }
  };

  // チーム紐付け解除処理
  const handleReset = async () => {
    setIsProcessing(true);
    setStatusMessage('登録解除中...');

    try {
      const userDocRef = doc(db, 'users', localUserId);
      await setDoc(
        userDocRef,
        {
          selectedTeamId: null,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
      setCurrentRegisteredTeam(null);
      setSelectedTeamId('');
      setStatusMessage('チームの紐付けを解除しました。');
    } catch (error) {
      console.error(
        '【エラーログ】チーム紐付け解除中にエラーが発生しました:',
        error,
      );
      setStatusMessage('解除処理に失敗しました。');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full max-w-md p-6 bg-white border border-slate-200 rounded-lg shadow-sm">
      <h2 className="text-lg font-bold text-slate-800 mb-2">
        参加チーム選択 / 招集通知設定
      </h2>
      <p className="text-sm text-slate-600 mb-4">
        所属する立（チーム）を選択すると、出番の2立前に自動で呼出プッシュ通知が届きます。
      </p>

      {/* 現在の登録状態表示 */}
      {currentRegisteredTeam && (
        <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded text-sm text-slate-700">
          現在登録中:{' '}
          <span className="font-semibold text-slate-900">
            {SAMPLE_TEAMS.find((t) => t.id === currentRegisteredTeam)?.name ||
              currentRegisteredTeam}
          </span>
        </div>
      )}

      {/* チーム選択ドロップダウン（UI制約・フールプルーフ） */}
      <div className="mb-4">
        <label
          htmlFor="team-select"
          className="block text-sm font-medium text-slate-700 mb-1"
        >
          立・チーム選択
        </label>
        <select
          id="team-select"
          value={selectedTeamId}
          onChange={(e) => setSelectedTeamId(e.target.value)}
          disabled={isProcessing}
          className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-slate-900 focus:outline-none text-sm bg-white"
        >
          <option value="">-- チームを選択してください --</option>
          {SAMPLE_TEAMS.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>

      {/* アクションボタン群 */}
      <div className="flex gap-2">
        <Button
          onClick={handleRegister}
          disabled={isProcessing || !selectedTeamId}
          className="flex-1"
        >
          {isProcessing ? '処理中...' : 'チームを登録 / 更新'}
        </Button>
        {currentRegisteredTeam && (
          <Button
            onClick={handleReset}
            variant="outline"
            disabled={isProcessing}
          >
            解除
          </Button>
        )}
      </div>

      {/* 状態・エラーメッセージ表示 */}
      {statusMessage && (
        <p className="mt-3 text-xs text-center text-slate-600 font-medium">
          {statusMessage}
        </p>
      )}
    </div>
  );
}
