/**
 * 【弓道大会運営システム ドメイン型・定数・サニタイズ関数定義】
 *
 * 競技構造仕様:
 * - 1立 = 選手5名（射位: 1大前, 2二的, 3中, 4落前, 5落）
 * - 1組 = 2立 = 選手10名（第1立・第2立 → 第1組、第3立・第4立 → 第2組...）
 * - 人数制限: 完全無制限（登録選手数に応じて立数・組数を動的算出）
 *
 * フールプルーフ設計:
 * - 射位インデックス（1〜5）、立インデックス（1〜3）をUnion型で制約。
 * - 立番号・組番号・ステータス等に対するサニタイズ関数により不正値を安全値へ強制補正。
 *
 * フェイルセーフ設計:
 * - STAND_CONFIGS, TOTAL_TOURNAMENT_SHOTS 等の競技ルールを不変定数としてエクスポート。
 * - standGroup, standOrder が null の場合でも画面クラッシュを回避する null 許容構造。
 */

// 的中結果区分（O: 的中 〇, X: はずれ ✕）
export type HitResult = 'O' | 'X';

// 所作区分（肌脱ぎ・襷掛け）
export type ShosaType = '肌脱ぎ' | '襷掛け';

// 称号・段位区分
export type RankTitleType =
  | '称号を取得している'
  | '段位は四段以上'
  | '段位は三段以下';

// 当日役員役割区分
export type StaffRoleType =
  | '進行'
  | '的前'
  | '招集'
  | '記録'
  | 'カメラマン'
  | '運営'
  | '無し';

// 当日役員シフト区分
export type StaffDutyShiftType = '午前のみ' | '午後のみ' | '終日' | '無し';

// 立ち順・射位（1: 大前, 2: 二的, 3: 中, 4: 落前, 5: 落）
export type StandOrderIndex = 1 | 2 | 3 | 4 | 5;

// ラウンド番号（1: 午前一手, 2: 午後一手, 3: 午後四矢）
export type StandRoundIndex = 1 | 2 | 3;

// 進行ステータス
export type ProgressStatus =
  | 'WAITING' // 待機中
  | 'CALLED' // 招集済（2立前呼出通知送信済）
  | 'IN_STAND' // 入場・射場待機
  | 'SHOOTING' // 行射中
  | 'FINISHED' // 立終了
  | 'COMPLETED'; // 全競技終了

// 当日入場チェックインステータス
export type CheckInStatus = 'UNCHECKED' | 'CHECKED_IN' | 'ABSENT';

// 参加資格ステータス
export type QualificationStatus = 'ACTIVE' | 'WITHDRAWN' | 'DISQUALIFIED';

// 正式案内・QRカード送信ステータス
export type QrDeliveryStatus = 'UNSENT' | 'SENT' | 'FAILED';

// 矢の的中判定（true: 的中 〇, false: はずれ ✕）
export type ArrowHit = boolean;

// 立順割当情報（standGroup は立番号を保持）
export interface StandAssignment {
  standGroup: number | null; // 立番号（第1立, 第2立...）
  standOrder: StandOrderIndex | null; // 射位（1〜5番）
}

// 立別競技設定定義
export interface StandConfig {
  round: StandRoundIndex;
  name: string;
  arrowsCount: number;
  format: '一手' | '四矢';
  timeSlot: '午前' | '午後';
}

// ==========================================
// 競技ルール定数定義
// ==========================================

// 大会総射数（午前の部: 一手2射 + 午後の部: 一手2射 + 四矢4射 = 計8射）
export const TOTAL_TOURNAMENT_SHOTS = 8;

// 1立あたりの最大射位数（大前〜落: 5名）
export const PLAYERS_PER_STAND = 5;

// 1組あたりの立数（2立 = 1組）
export const STANDS_PER_GROUP = 2;

// 1組あたりの最大定員（10名）
export const PLAYERS_PER_GROUP = PLAYERS_PER_STAND * STANDS_PER_GROUP;

// 各立の構成設定マップ
export const STAND_CONFIGS: Record<StandRoundIndex, StandConfig> = {
  1: {
    round: 1,
    name: '第1立 (午前・一手)',
    arrowsCount: 2,
    format: '一手',
    timeSlot: '午前',
  },
  2: {
    round: 2,
    name: '第2立 (午後・一手)',
    arrowsCount: 2,
    format: '一手',
    timeSlot: '午後',
  },
  3: {
    round: 3,
    name: '第3立 (午後・四矢)',
    arrowsCount: 4,
    format: '四矢',
    timeSlot: '午後',
  },
};

// ==========================================
// 主要データモデル定義
// ==========================================

// 参加選手データモデル
export interface Participant {
  id: string; // Firestore ドキュメントID
  bibNumber: number; // ゼッケン番号
  name: string; // 選手氏名
  nameKana: string; // ふりがな
  organization: string; // 所属支部・団体
  shosa: ShosaType; // 所作
  rankTitle: RankTitleType; // 称号・段位
  staffRole: StaffRoleType; // 役員役割
  staffDutyShift: StaffDutyShiftType; // 役員シフト
  checkInStatus: CheckInStatus; // 当日受付状態
  checkInAt: number | null; // 受付日時（UNIXミリ秒）
  checkInMethod?: 'QR_SCAN' | 'MANUAL' | null; // 受付手段
  isStaffVolunteer: boolean; // 役員協力可否
  needsSupport: boolean; // 所作サポート希望
  standAssignments: Record<StandRoundIndex, StandAssignment>; // 各ラウンドの立ち順割当
  progressStatus: ProgressStatus; // 進行状況
  qualificationStatus: QualificationStatus; // 参加資格
  stand1_arrows: ArrowHit[]; // 第1立（一手2射）的中記録
  stand2_arrows: ArrowHit[]; // 第2立（一手2射）的中記録
  stand3_arrows: ArrowHit[]; // 第3立（四矢4射）的中記録
  isHayaHit: boolean; // 甲矢（第1射）的中フラグ
  totalHits: number; // 合計的中数（最大8）
  totalShots: number; // 合計行射数（通常8）
  isPerfect: boolean; // 皆中（8射8中）フラグ
  enkinRank: number | null; // 遠近競射確定順位
  finalRank: number | null; // 最終確定順位
  representativeName: string; // 申込代表者氏名
  representativeEmail: string; // 申込代表者メールアドレス
  representativePhone: string; // 申込代表者電話番号
  representativeOrganization: string; // 申込代表者所属
  isPaid: boolean; // 参加費納付済フラグ
  paidAt: number | null; // 納付承認日時（UNIXミリ秒）
  notes: string; // 備考
  qrSentStatus: QrDeliveryStatus; // 正式QRカード配信状態
  qrSentAt: number | null; // QR送信日時
  qrSentError: string | null; // QR送信エラー詳細
  agreedAt?: number; // 規約同意日時
  updatedAt?: number; // 最終更新日時
  userId?: string; // 紐付け端末UID
}

// チーム情報データモデル（団体戦・進行管理用）
export interface Team {
  id: string;
  name: string;
  organization: string;
  standOrder: number;
  standGroup?: number;
  createdAt?: number;
  updatedAt?: number;
}

// ユーザー端末・FCM通知管理データモデル
export interface AppUser {
  userId: string; // Firebase Auth UID または 端末固有ID
  participantId?: string; // 紐付け選手ID
  bibNumber?: number; // ゼッケン番号
  playerName?: string; // 選手氏名
  teamId?: string; // 所属チームID
  teamName?: string; // 所属チーム名
  standGroup?: number; // 所属立番号
  fcmToken: string | null; // FCMプッシュ通知デバイストークン
  updatedAt: number; // 更新日時
}

// 大会設定データモデル
export interface TournamentConfig {
  matchId: string; // 大会識別子
  title: string; // 大会名称
  date: string; // 開催日 (YYYY-MM-DD)
  venue: string; // 競技会場
  totalStandGroups: number; // 総立数
  currentStandGroup?: number; // 現在進行中の立
  currentRound?: StandRoundIndex; // 現在進行中のラウンド (1:午前一手, 2:午後一手, 3:午後四矢)
  isEntryOpen?: boolean; // エントリー受付中フラグ
}

// 競射（タイブレーク）データモデル
export interface TieBreakerState {
  type: 'IZUME' | 'ENKIN'; // 射詰（優勝決定）または 遠近（順位決定）
  targetRank: number; // 対象順位
  candidateParticipantIds: string[]; // 対象選手IDリスト
  roundHistory: Record<string, boolean[]>; // 射詰時の選手別的中推移
  enkinDistanceOrder?: string[]; // 遠近競射時の的中位置順リスト
  isResolved: boolean; // 決着フラグ
}

// 招集・呼出FCMプッシュ通知送信履歴ログデータモデル
export interface CallNotificationLog {
  id: string; // ログID
  matchId: string; // 大会ID
  round: StandRoundIndex; // 対象ラウンド
  standGroup: number; // 対象立番号
  title: string; // 通知件名
  body: string; // 通知本文
  targetPlayerCount: number; // 立内総選手数
  tokensFoundCount: number; // FCMトークン保有者数
  sentSuccessCount: number; // 送信成功数
  sentFailureCount: number; // 送信失敗数
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'; // 送信結果ステータス
  triggerType: 'AUTO_PROGRESS' | 'MANUAL_EXECUTE'; // トリガー種別
  errorDetail?: string | null; // エラー詳細
  createdAt: number; // 作成日時 (UNIXミリ秒)
}

// ==========================================
// 立・組 構造計算ヘルパー関数群
// ==========================================

/**
 * 立番号から組番号を算出（第1・2立 → 第1組、第3・4立 → 第2組...）
 */
export function calculateGroupFromStand(standNumber: number): number {
  if (standNumber <= 0) return 1;
  return Math.ceil(standNumber / STANDS_PER_GROUP);
}

/**
 * 組番号から含まれる立番号範囲を算出（第1組 → [1, 2]、第2組 → [3, 4]...）
 */
export function calculateStandsFromGroup(
  groupNumber: number,
): [number, number] {
  const safeGroup = Math.max(1, groupNumber);
  const endStand = safeGroup * STANDS_PER_GROUP;
  const startStand = endStand - 1;
  return [startStand, endStand];
}

/**
 * 選手総数から必要な総立数を動的算出（5名単位で切り上げ）
 */
export function calculateTotalStands(playerCount: number): number {
  if (playerCount <= 0) return 1;
  return Math.ceil(playerCount / PLAYERS_PER_STAND);
}

/**
 * 選手総数から必要な総組数を動的算出（10名単位で切り上げ）
 */
export function calculateTotalGroups(playerCount: number): number {
  if (playerCount <= 0) return 1;
  return Math.ceil(playerCount / PLAYERS_PER_GROUP);
}

// ==========================================
// 型ガード・サニタイズ関数群（フールプルーフ）
// ==========================================

export function isHitResult(val: unknown): val is HitResult {
  return val === 'O' || val === 'X';
}

export function sanitizeStandGroup(val: unknown): number | null {
  if (typeof val === 'number' && !isNaN(val) && val > 0) {
    return Math.floor(val);
  }
  if (typeof val === 'string') {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export function sanitizeStandOrder(val: unknown): StandOrderIndex | null {
  const num =
    typeof val === 'number'
      ? val
      : typeof val === 'string'
        ? parseInt(val, 10)
        : null;
  if (num === 1 || num === 2 || num === 3 || num === 4 || num === 5) {
    return num as StandOrderIndex;
  }
  return null;
}

export function sanitizeShosaType(val: unknown): ShosaType {
  if (val === '襷掛け') return '襷掛け';
  return '肌脱ぎ';
}

export function sanitizeRankTitleType(val: unknown): RankTitleType {
  if (val === '称号を取得している' || val === '段位は四段以上') {
    return val;
  }
  return '段位は三段以下';
}

export function sanitizeStaffRole(val: unknown): StaffRoleType {
  const validRoles: StaffRoleType[] = [
    '進行',
    '的前',
    '招集',
    '記録',
    'カメラマン',
    '運営',
    '無し',
  ];
  if (typeof val === 'string' && validRoles.includes(val as StaffRoleType)) {
    return val as StaffRoleType;
  }
  return '無し';
}

export function sanitizeCheckInStatus(val: unknown): CheckInStatus {
  if (val === 'CHECKED_IN' || val === 'ABSENT' || val === 'UNCHECKED') {
    return val as CheckInStatus;
  }
  return 'UNCHECKED';
}

export function sanitizeProgressStatus(val: unknown): ProgressStatus {
  const validStatuses: ProgressStatus[] = [
    'WAITING',
    'CALLED',
    'IN_STAND',
    'SHOOTING',
    'FINISHED',
    'COMPLETED',
  ];
  if (
    typeof val === 'string' &&
    validStatuses.includes(val as ProgressStatus)
  ) {
    return val as ProgressStatus;
  }
  return 'WAITING';
}

export function sanitizeQualificationStatus(val: unknown): QualificationStatus {
  if (val === 'ACTIVE' || val === 'WITHDRAWN' || val === 'DISQUALIFIED') {
    return val as QualificationStatus;
  }
  return 'ACTIVE';
}
