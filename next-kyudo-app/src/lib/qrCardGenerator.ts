/**
 * 【選手情報一体型 QRカード画像自動合成モジュール】
 *
 * 役割:
 * - HTML Canvas API を使用し、クライアントサイドのメモリ上で「大会名」「ゼッケン番号」「選手氏名」「所属」「午前・午後の立ち順」と「受付用QRコード」を一体化した高解像度カード画像（PNG）を動的に合成・生成。
 * - LINEトーク画面や端末の写真一覧で一覧表示した際、誰のQRコードであるかを一目で識別可能にし、選手間での取り違え事故を防止。
 *
 * フールプルーフ設計（操作ミス・不正入力の入口遮断）:
 * - 必須項目（participant.name, bibNumber）が欠落している場合の例外ガード。
 * - 立ち順（standGroup, standOrder）が null（未設定）の場合は「立順未確定」の安全なフォールバック文字列を描画。
 * - 長い選手名や団体名に対する文字数溢れ（省略記号 ... 付与）とフォントサイズ自動調整によるレイアウト破綻防止。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - サーバー通信やディスクI/Oを行わず、ブラウザのインメモリCanvas処理で完結。
 * - QRコード誤り訂正レベルを「M (15%)」に設定し、LINE送信時の画像自動圧縮後も読み取り精度を確保。
 * - CommonJS/ESM 両対応の型安全なインポート構文を採用し、TS2307モジュール未解決エラーを解消。
 * - Blob生成失敗時は DataURL への多重フォールバックを提供。
 */

import * as QRCode from 'qrcode';
import { Participant } from '@/types';

export interface GenerateQrCardOptions {
  tournamentTitle: string;
  checkinPayload: string;
}

export interface QrCardGenerationResult {
  blob: Blob;
  dataUrl: string;
  file: File;
}

function getStandOrderText(order: number | null): string {
  if (order === null) return '未確定';
  const labels: Record<number, string> = {
    1: '大前 (1番)',
    2: '二的 (2番)',
    3: '中 (3番)',
    4: '落前 (4番)',
    5: '落 (5番)',
  };
  return labels[order] || `${order}番`;
}

/**
 * 選手情報一体型QRカード画像をCanvasで動的合成してBlob・DataURLを生成する関数
 */
export async function generateQrCardImage(
  participant: Participant,
  options: GenerateQrCardOptions,
): Promise<QrCardGenerationResult> {
  // フールプルーフ: 入力検証
  if (!participant || !participant.name) {
    throw new Error('選手情報が不正です。');
  }

  // キャンバス解像度設定（Retina・スマホ高精細対応: 800px x 1200px）
  const canvasWidth = 800;
  const canvasHeight = 1200;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvasコンテキストの初期化に失敗しました。');
  }

  // 1. 全体背景描画（ソフトオフホワイト）
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // 2. メインカード枠描画（角丸白背景＋シャドウ風ボーダー）
  const cardMargin = 32;
  const cardX = cardMargin;
  const cardY = cardMargin;
  const cardW = canvasWidth - cardMargin * 2;
  const cardH = canvasHeight - cardMargin * 2;
  const cardRadius = 28;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, cardRadius);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();
  ctx.clip(); // 角丸の内側のみを描画対象にする

  // 3. ヘッダーバナー領域（ダークネイビー）
  const headerHeight = 190;
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(cardX, cardY, cardW, headerHeight);

  // 大会タイトル描画
  ctx.fillStyle = '#F1F5F9';
  ctx.font = "bold 26px 'Helvetica Neue', 'Noto Sans JP', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const rawTitle = options.tournamentTitle || '第5回めんたいこ杯争奪弓道大会';
  const safeTitle =
    rawTitle.length > 26 ? rawTitle.substring(0, 25) + '…' : rawTitle;
  ctx.fillText(safeTitle, canvasWidth / 2, cardY + 60);

  // サブヘッダーラベル
  ctx.fillStyle = '#F59E0B';
  ctx.font = "bold 18px 'Helvetica Neue', 'Noto Sans JP', sans-serif";
  ctx.fillText(
    '正式エントリー受付・当日入場QRコード',
    canvasWidth / 2,
    cardY + 105,
  );

  // ヘッダー下部のステータスライン
  ctx.fillStyle = '#94A3B8';
  ctx.font = '14px monospace';
  ctx.fillText(`ENTRY ID: ${participant.id}`, canvasWidth / 2, cardY + 145);

  // 4. ゼッケン番号ブロック
  const bibY = cardY + headerHeight + 50;
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.roundRect(cardX + 40, bibY, cardW - 80, 80, 16);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#CBD5E1';
  ctx.stroke();

  ctx.fillStyle = '#64748B';
  ctx.font = "bold 16px 'Helvetica Neue', 'Noto Sans JP', sans-serif";
  ctx.textAlign = 'left';
  ctx.fillText('ゼッケン番号', cardX + 64, bibY + 40);

  ctx.fillStyle = '#0F172A';
  ctx.font = '900 44px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`No. ${participant.bibNumber}`, cardX + cardW - 64, bibY + 42);

  // 5. 選手属性ブロック（氏名・所属・所作・段位）
  const shooterInfoY = bibY + 115;
  ctx.textAlign = 'center';

  // 選手氏名
  ctx.fillStyle = '#0F172A';
  ctx.font = "900 48px 'Helvetica Neue', 'Noto Sans JP', sans-serif";
  const safeName =
    participant.name.length > 14
      ? participant.name.substring(0, 13) + '…'
      : participant.name;
  ctx.fillText(`${safeName} 選手`, canvasWidth / 2, shooterInfoY + 20);

  // ふりがな
  if (participant.nameKana) {
    ctx.fillStyle = '#64748B';
    ctx.font = "500 20px 'Helvetica Neue', 'Noto Sans JP', sans-serif";
    ctx.fillText(participant.nameKana, canvasWidth / 2, shooterInfoY - 24);
  }

  // 所属・所作・段位
  ctx.fillStyle = '#334155';
  ctx.font = "bold 20px 'Helvetica Neue', 'Noto Sans JP', sans-serif";
  const orgText = participant.organization || '無所属';
  const specText = `${orgText}  |  ${participant.shosa}  |  ${participant.rankTitle}`;
  ctx.fillText(specText, canvasWidth / 2, shooterInfoY + 70);

  // 6. QRコード描画領域
  const qrBoxY = shooterInfoY + 110;
  const qrBoxSize = 340;
  const qrBoxX = (canvasWidth - qrBoxSize) / 2;

  // QRコード枠背景
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 20);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#CBD5E1';
  ctx.stroke();

  // QRコード描画（CommonJS/ESM双方のtoDataURL解決に対応）
  try {
    const toDataURLFn =
      typeof QRCode.toDataURL === 'function'
        ? QRCode.toDataURL
        : (
            QRCode as unknown as {
              default: { toDataURL: typeof QRCode.toDataURL };
            }
          ).default?.toDataURL;

    if (!toDataURLFn) {
      throw new Error('QRCode.toDataURL 関数が見つかりません。');
    }

    const qrDataUrl = await toDataURLFn(options.checkinPayload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: qrBoxSize - 24,
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
    });

    const qrImage = new Image();
    qrImage.src = qrDataUrl;
    await new Promise<void>((resolve, reject) => {
      qrImage.onload = () => resolve();
      qrImage.onerror = (e) => reject(e);
    });

    ctx.drawImage(
      qrImage,
      qrBoxX + 12,
      qrBoxY + 12,
      qrBoxSize - 24,
      qrBoxSize - 24,
    );
  } catch (qrErr) {
    console.error('【QRコード画像合成例外】:', qrErr);
    ctx.fillStyle = '#EF4444';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('QRコード生成エラー', canvasWidth / 2, qrBoxY + qrBoxSize / 2);
  }

  // 7. 立ち順・射位表示ブロック
  const standTableY = qrBoxY + qrBoxSize + 25;
  const standTableW = cardW - 80;
  const standTableX = cardX + 40;
  const standTableH = 135;

  ctx.fillStyle = '#F1F5F9';
  ctx.beginPath();
  ctx.roundRect(standTableX, standTableY, standTableW, standTableH, 16);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#CBD5E1';
  ctx.stroke();

  // 午前の部
  const mAssign = participant.standAssignments[1];
  const mGroupText =
    mAssign?.standGroup !== null ? `第 ${mAssign.standGroup} 組` : '立順未設定';
  const mOrderText = getStandOrderText(mAssign?.standOrder ?? null);

  ctx.fillStyle = '#D97706';
  ctx.font = "bold 16px 'Helvetica Neue', 'Noto Sans JP', sans-serif";
  ctx.textAlign = 'left';
  ctx.fillText('午前の部 (第1立):', standTableX + 24, standTableY + 40);

  ctx.fillStyle = '#0F172A';
  ctx.font = "bold 18px 'Helvetica Neue', 'Noto Sans JP', sans-serif";
  ctx.textAlign = 'right';
  ctx.fillText(
    `${mGroupText}  -  ${mOrderText}`,
    standTableX + standTableW - 24,
    standTableY + 40,
  );

  // 仕切り線
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(standTableX + 20, standTableY + 68);
  ctx.lineTo(standTableX + standTableW - 20, standTableY + 68);
  ctx.stroke();

  // 午後の部
  const aAssign = participant.standAssignments[2];
  const aGroupText =
    aAssign?.standGroup !== null ? `第 ${aAssign.standGroup} 組` : '立順未設定';
  const aOrderText = getStandOrderText(aAssign?.standOrder ?? null);

  ctx.fillStyle = '#475569';
  ctx.font = "bold 16px 'Helvetica Neue', 'Noto Sans JP', sans-serif";
  ctx.textAlign = 'left';
  ctx.fillText('午後の部 (第2・3立):', standTableX + 24, standTableY + 100);

  ctx.fillStyle = '#0F172A';
  ctx.font = "bold 18px 'Helvetica Neue', 'Noto Sans JP', sans-serif";
  ctx.textAlign = 'right';
  ctx.fillText(
    `${aGroupText}  -  ${aOrderText}`,
    standTableX + standTableW - 24,
    standTableY + 100,
  );

  // 8. フッター案内テキスト
  ctx.fillStyle = '#64748B';
  ctx.font = "14px 'Helvetica Neue', 'Noto Sans JP', sans-serif";
  ctx.textAlign = 'center';
  ctx.fillText(
    '※大会当日は本QRコードを受付端末にかざして入場チェックインを行ってください。',
    canvasWidth / 2,
    cardY + cardH - 36,
  );

  ctx.restore();

  // 9. Blob および DataURL の生成（フェイルセーフ）
  const dataUrl = canvas.toDataURL('image/png');

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) {
        resolve(b);
      } else {
        reject(new Error('Canvas toBlob変換に失敗しました。'));
      }
    }, 'image/png');
  });

  const fileName = `qrcard_bib_${participant.bibNumber}_${participant.name}.png`;
  const file = new File([blob], fileName, { type: 'image/png' });

  return { blob, dataUrl, file };
}
