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
 * - 競技形態、射数形式、競射形式をリテラルユニオン型で厳格に定義。
 * - 立番号・組番号・ステータス等に対するサニタイズ関数により不正値を安全値へ強制補正。
 * - 旧仕様の型参照との互換性を担保する型エイリアスを提供。
 *
 * フェイルセーフ設計:
 * - STAND_CONFIGS, TOTAL_TOURNAMENT_SHOTS 等の競技ルールを不変定数としてエクスポート。
 * - standGroup, standOrder が null の場合でも画面クラッシュを回避する null 許容構造。
 */

// ==========================================
// 試合形式・競技設定型定義
// ==========================================

// 競技形態区分（個人戦 / 団体戦 / 個人・団体複合）
export type MatchType = 'INDIVIDUAL' | 'TEAM' | 'HYBRID';

// 行射射数フォーマット（一手: 2射 / 四矢: 4射）
export type ArrowCountFormat = '一手' | '四矢';

// 同中発生時の競射形式（射詰 / 遠近 / 競射なし）
export type TieBreakerFormat = '射詰' | '遠近' | 'なし';

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

// ラウンド（ステージ）番号（1: 第1ステージ, 2: 第2ステージ, 3: 第3ステージ）
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

// 矢の的中判定（true: 的中 〇, false: はずれ ✕, null: 未入力）
export type ArrowHit = boolean | null;

// ==========================================
// 後方互換用型エイリアス
// ==========================================

export type StandOrderType = StandOrderIndex;
export type ArrowCountType = ArrowCountFormat;
export type CompetitionCategory = '個人' | '団体';
export type ArrowRule = ArrowCountFormat;
export type TieBreakerMethod = TieBreakerFormat;
export type TieBreakerRule = TieBreakerFormat;
export type MatchStatus = string;

// 立順割当情報（standGroup は立番号を保持）
export interface StandAssignment {
  standGroup: number | null; // 立番号（第1立, 第2立...）
  standOrder: StandOrderIndex | null; // 射位（1〜5番）
}

// 立（ステージ）別競技設定定義
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

// 大会総射数（第1S: 一手2射 + 第2S: 一手2射 + 第3S: 四矢4射 = 計8射）
export const TOTAL_TOURNAMENT_SHOTS = 8;

// 1立あたりの最大射位数（大前〜落: 5名）
export const PLAYERS_PER_STAND = 5;

// 1組あたりの立数（2立 = 1組）
export const STANDS_PER_GROUP = 2;

// 1組あたりの最大定員（10名）
export const PLAYERS_PER_GROUP = PLAYERS_PER_STAND * STANDS_PER_GROUP;

// 各立の構成設定マップ（ステージ制）
export const STAND_CONFIGS: Record<StandRoundIndex, StandConfig> = {
  1: {
    round: 1,
    name: '第1ステージ (午前・一手)',
    arrowsCount: 2,
    format: '一手',
    timeSlot: '午前',
  },
  2: {
    round: 2,
    name: '第2ステージ (午後・一手)',
    arrowsCount: 2,
    format: '一手',
    timeSlot: '午後',
  },
  3: {
    round: 3,
    name: '第3ステージ (午後・四矢)',
    arrowsCount: 4,
    format: '四矢',
    timeSlot: '午後',
  },
};

// ==========================================
// 主要データモデル定義
// ==========================================

// 大会設定データモデル（ウィザード設定・エントリー制御拡張版）
export interface TournamentConfig {
  matchId: string; // 大会識別子
  title: string; // 大会名称
  date: string; // 開催日 (YYYY-MM-DD)
  venue: string; // 競技会場
  totalStandGroups?: number; // 設定上の総組数（動的算出により省略可）
  totalStands?: number; // 設定上の総立数
  totalArrows?: number; // 総射数
  tieBreakerFormat?: TieBreakerFormat | string; // 競射形式 (射詰など)
  status?: string; // 進行ステータス
  currentStandGroup?: number; // 現在進行中の組
  currentStandNumber?: number; // 現在進行中の立
  currentRound?: StandRoundIndex; // 現在進行中のステージ
  maxStandGroup?: number; // 最大組数
  entryStartDate?: string; // エントリー受付開始日時 (ISO文字列)
  entryEndDate?: string; // エントリー受付終了日時 (ISO文字列)
  isEntryEnabled?: boolean; // エントリー受付有効フラグ
  targetCount?: number; // 射場規模 (的数)
  matchType?: MatchType; // 競技形態 (個人/団体/複合)
  playersPerTeam?: number; // 1チームあたりの人数
  preliminaryArrowCount?: ArrowCountFormat; // 予選1立あたりの射数
  preliminaryStands?: number; // 予選総立数
  finalArrowCount?: ArrowCountFormat; // 決勝1立あたりの射数
  finalStands?: number; // 決勝総立数
  maxStandNumber?: number; // 最大立数
  updatedAt?: unknown; // 最終更新日時
}

export type Match = TournamentConfig;

// 大会要項設定データモデル（/guidelines 制御用）
export interface TournamentGuidelines {
  matchId: string;
  title: string;
  dateText: string;
  venueText: string;
  organizerText: string;
  competitionRulesText: string;
  eligibilityText: string;
  entryFeeText: string;
  notesText: string;
  entryStartDate: string;
  entryEndDate: string;
  isEntryEnabled: boolean;
  totalStands: number;
  totalArrows: number;
  tieBreakerFormat: TieBreakerFormat | string;
  status: string;
  currentStandGroup: number;
  maxStandGroup: number;
  updatedAt?: unknown;
}

// ==========================================
// エントリーフォーム用データモデル
// ==========================================

// エントリー時の個別選手情報
export interface EntryPlayerItem {
  name: string;
  nameKana: string;
  shosa: ShosaType;
  rankTitle: RankTitleType;
  needsSupport: boolean;
  isStaffVolunteer: boolean;
}

// エントリーフォーム全体のデータ構造
export interface RepresentativeEntryFormData {
  representativeName: string;
  representativeEmail: string;
  representativePhone: string;
  representativeOrganization: string;
  players: EntryPlayerItem[];
  notes: string;
}

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
  stand1_arrows: ArrowHit[]; // 第1ステージ（一手2射）的中記録
  stand2_arrows: ArrowHit[]; // 第2ステージ（一手2射）的中記録
  stand3_arrows: ArrowHit[]; // 第3ステージ（四矢4射）的中記録
  isHayaHit: boolean; // 一立目甲矢的中賞（第1Sの1本目）フラグ
  isSokuchu: boolean; // 一手束中賞（第1Sまたは第2Sでの2中）フラグ
  totalHits: number; // 合計的中数（最大8）
  totalShots: number; // 合計行射数（通常8）
  isPerfect: boolean; // 四矢皆中賞（第3Sで4中）フラグ
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

// ==========================================
// スコア記録・集計関連データモデル
// ==========================================

export interface ScoreHistoryItem {
  round: StandRoundIndex;
  shotNumber: number;
  hit: boolean;
  timestamp: number;
}

export interface ScoreRecord {
  participantId: string;
  round: StandRoundIndex;
  arrows: ArrowHit[];
  totalHits: number;
  updatedAt: number;
}

export interface TieBreakerRecord {
  participantId: string;
  type: 'IZUME' | 'ENKIN';
  hits: boolean[];
  rank: number | null;
}

export interface PlayerScore {
  participantId: string;
  stand1_hits: number;
  stand2_hits: number;
  stand3_hits: number;
  totalHits: number;
}

export interface StandMatchScore {
  standGroup: number;
  round: StandRoundIndex;
  scores: Record<string, ArrowHit[]>;
}

export interface MatchProgress {
  currentStandGroup: number;
  currentRound: StandRoundIndex;
  status: ProgressStatus;
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
  round: StandRoundIndex; // 対象ステージ
  standGroup: number; // 対象組番号
  title: string; // 通知件名
  body: string; // 通知本文
  targetPlayerCount: number; // 組内総選手数
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

export function calculateGroupFromStand(standNumber: number): number {
  if (standNumber <= 0) return 1;
  return Math.ceil(standNumber / STANDS_PER_GROUP);
}

export function calculateStandsFromGroup(
  groupNumber: number,
): [number, number] {
  const safeGroup = Math.max(1, groupNumber);
  const endStand = safeGroup * STANDS_PER_GROUP;
  const startStand = endStand - 1;
  return [startStand, endStand];
}

export function calculateTotalStands(playerCount: number): number {
  if (playerCount <= 0) return 1;
  return Math.ceil(playerCount / PLAYERS_PER_STAND);
}

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

export function isStandRoundIndex(val: unknown): val is StandRoundIndex {
  return val === 1 || val === 2 || val === 3;
}

export function sanitizeStandRoundIndex(val: unknown): StandRoundIndex {
  if (val === 1 || val === 2 || val === 3) return val;
  return 1;
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

export function isShosaType(val: unknown): val is ShosaType {
  return val === '肌脱ぎ' || val === '襷掛け';
}

export function sanitizeShosaType(val: unknown): ShosaType {
  if (val === '襷掛け') return '襷掛け';
  return '肌脱ぎ';
}

export function isRankTitleType(val: unknown): val is RankTitleType {
  return (
    val === '称号を取得している' ||
    val === '段位は四段以上' ||
    val === '段位は三段以下'
  );
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

export function isCheckInStatus(val: unknown): val is CheckInStatus {
  return val === 'CHECKED_IN' || val === 'ABSENT' || val === 'UNCHECKED';
}

export function sanitizeCheckInStatus(val: unknown): CheckInStatus {
  if (val === 'CHECKED_IN' || val === 'ABSENT' || val === 'UNCHECKED') {
    return val as CheckInStatus;
  }
  return 'UNCHECKED';
}

export function isProgressStatus(val: unknown): val is ProgressStatus {
  return (
    val === 'WAITING' ||
    val === 'CALLED' ||
    val === 'IN_STAND' ||
    val === 'SHOOTING' ||
    val === 'FINISHED' ||
    val === 'COMPLETED'
  );
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

export function isQualificationStatus(
  val: unknown,
): val is QualificationStatus {
  return val === 'ACTIVE' || val === 'WITHDRAWN' || val === 'DISQUALIFIED';
}

export function sanitizeQualificationStatus(val: unknown): QualificationStatus {
  if (val === 'ACTIVE' || val === 'WITHDRAWN' || val === 'DISQUALIFIED') {
    return val as QualificationStatus;
  }
  return 'ACTIVE';
}
