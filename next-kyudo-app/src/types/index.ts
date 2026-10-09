/**
 * 【弓道大会運営システム 共通ドメイン型定義モジュール】
 *
 * 役割:
 * - 競技形式（個人戦・全8射: 午前一手2射 / 午後一手2射 / 午後四矢4射）の統合定義。
 * - 立構造・矢数マスター（STAND_CONFIGS, TOTAL_TOURNAMENT_SHOTS）の定数提供。
 * - 選手・チーム・スコア・大会設定・通知・QR発行に跨る全データモデルの型安全性の保証。
 * - 組番号・立順（射位）の未設定（null）許容仕様に対応。
 * - 入力データの整合性を保つ型ガードおよびサニタイズ関数の提供。
 *
 * フールプルーフ設計（操作ミス・不正データの入口遮断）:
 * - 的中結果（HitResult: 1 | 0）、立番号（StandRoundIndex: 1 | 2 | 3）、立順（StandOrderIndex: 1〜5）の厳格リテラル型化。
 * - 型ガード関数群により、外部入力値や破損データを早期に検知・補正。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - 不正な立番号や矢数、ステータス値が渡された場合でも、サニタイズ関数により安全なデフォルト値へ自動フォールバック。
 */

// ==========================================
// 1. 弓道ドメイン 基礎プリミティブ型
// ==========================================

// 的中結果（1: 的中〇, 0: 外れ✕）
export type HitResult = 1 | 0;

// 立インデックス（1: 第1立・午前一手2射, 2: 第2立・午後一手2射, 3: 第3立・午後四矢4射）
export type StandRoundIndex = 1 | 2 | 3;

// 立順（射位番号: 1番大前 〜 5番落）
export type StandOrderIndex = 1 | 2 | 3 | 4 | 5;

// 下位互換エイリアス（null許容）
export type StandOrderType = StandOrderIndex | null;

// 矢数種別（2: 一手, 4: 四矢）
export type ArrowCountType = 2 | 4;

// 競技種別（個人戦 / 団体戦）
export type CompetitionCategory = 'INDIVIDUAL' | 'TEAM';
export type MatchType = 'INDIVIDUAL' | 'TEAM';

// 矢数ルール（一手: 2射, 四矢: 4射）
export type ArrowRule = 'HITOTE' | 'YOTSUYA';

// 順位決定戦方式（IZUME: 射詰サドンデス, ENKIN: 遠近中心距離判定）
export type TieBreakerMethod = 'IZUME' | 'ENKIN';
export type TieBreakerRule = 'IZUME' | 'ENKIN';

// 所作区分
export type ShosaType = '肌脱ぎ' | '襷掛け';

// 称号・段位区分
export type RankTitleType =
  | '段位は三段以下'
  | '段位は四段以上'
  | '称号を取得している';

// 役員役割区分
export type StaffRoleType =
  | '進行'
  | '的前'
  | '招集'
  | '記録'
  | 'カメラマン'
  | '運営'
  | '無し';

// 役員担当時間帯区分
export type StaffDutyShiftType = 'AM' | 'PM' | '終日' | '無し';

// 受付ステータス
export type CheckInStatus = 'UNCHECKED' | 'CHECKED_IN' | 'ABSENT';

// 競技進行ステータス
export type ProgressStatus =
  | 'WAITING'
  | 'CALLED'
  | 'IN_STAND'
  | 'SHOOTING'
  | 'FINISHED'
  | 'COMPLETED';

// 参加資格ステータス
export type QualificationStatus = 'ACTIVE' | 'DISQUALIFIED' | 'WITHDRAWN';

// 大会進行ステータス
export type MatchStatus = 'READY' | 'IN_PROGRESS' | 'TIE_BREAKER' | 'FINISHED';

// QRコード送信ステータス
export type QrDeliveryStatus = 'UNSENT' | 'SENT' | 'FAILED';

// ==========================================
// 2. 立構造・大会設定モデル & 定数マスター
// ==========================================

export interface StandConfig {
  roundIndex: StandRoundIndex;
  name: string;
  periodName: '午前の部' | '午後の部';
  formatDescription: string;
  arrowCount: ArrowCountType;
}

/**
 * 競技構成マスター設定
 * - 第1立: 午前 一手（2射）※甲矢的中特別賞対象
 * - 第2立: 午後 一手（2射）
 * - 第3立: 午後 四矢（4射）
 * 合計: 8射
 */
export const STAND_CONFIGS: Record<StandRoundIndex, StandConfig> = {
  1: {
    roundIndex: 1,
    name: '第1立 (午前・一手)',
    periodName: '午前の部',
    formatDescription: '一次審査要領・一手（2射）/ 甲矢的中特別賞対象',
    arrowCount: 2,
  },
  2: {
    roundIndex: 2,
    name: '第2立 (午後・一手)',
    periodName: '午後の部',
    formatDescription: '一次審査要領・一手（2射）',
    arrowCount: 2,
  },
  3: {
    roundIndex: 3,
    name: '第3立 (午後・四矢)',
    periodName: '午後の部',
    formatDescription: '立射・四矢（4射）',
    arrowCount: 4,
  },
};

// 大会規定総射数（2 + 2 + 4 = 8射）
export const TOTAL_TOURNAMENT_SHOTS = 8;

export interface TournamentConfig {
  matchId: string;
  title: string;
  date?: string;
  venue?: string;
  totalStandGroups?: number;
  totalStands?: number;
  totalArrows?: number;
  tieBreakerFormat?: string;
  status?: MatchStatus;
  currentStandGroup?: number;
  maxStandGroup?: number;
  entryStartDate?: string;
  entryEndDate?: string;
  isEntryEnabled?: boolean;
}

export interface Match {
  id: string;
  title: string;
  matchType: MatchType;
  arrowRule: ArrowRule;
  tieBreakerRule: TieBreakerRule;
  currentStandOrder: number;
  totalStands: number;
  isCompleted: boolean;
  createdAt: number;
  updatedAt: number;
}

// ==========================================
// 3. 立配置・スコア・競射モデル
// ==========================================

export interface StandAssignment {
  standGroup: number | null;
  standOrder: StandOrderIndex | null;
}

export interface ScoreHistoryItem {
  arrowIndex: number;
  result: HitResult;
  timestamp: number;
}

export interface ScoreRecord {
  id: string;
  matchId: string;
  teamId: string;
  playerId: string;
  playerName: string;
  standOrder: number;
  arrows: HitResult[];
  history: ScoreHistoryItem[];
  totalHits: number;
  updatedAt: number;
}

export interface TieBreakerRecord {
  method: TieBreakerMethod;
  arrows: HitResult[];
  distanceMm?: number;
  rank?: number;
}

export interface PlayerScore {
  playerId: string;
  playerName: string;
  bibNumber: number;
  name: string;
  nameKana: string;
  organization: string;
  shosa: ShosaType;
  staffRole: StaffRoleType;
  qualificationStatus: QualificationStatus;
  standAssignments: Record<StandRoundIndex, StandAssignment>;
  stand1_arrows: HitResult[];
  stand2_arrows: HitResult[];
  stand3_arrows: HitResult[];
  isHayaHit?: boolean;
  tieBreaker?: TieBreakerRecord;
  totalHits: number;
  isCompleted: boolean;
  isPerfect: boolean;
}

export interface StandMatchScore {
  matchId: string;
  standGroup: number;
  roundIndex: StandRoundIndex;
  playerScores: Record<string, PlayerScore>;
  isLocked: boolean;
  updatedAt: number;
}

// ==========================================
// 4. チーム・ユーザー・進行通知モデル
// ==========================================

export interface Team {
  id: string;
  name: string;
  organization: string;
  standOrder: number;
  standGroup?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface AppUser {
  userId: string;
  teamId: string;
  teamName: string;
  participantId?: string;
  playerName?: string;
  bibNumber?: number;
  standGroup?: number;
  fcmToken: string | null;
  updatedAt: number;
  tokenCleanedAt?: number;
}

export interface MatchProgress {
  matchId: string;
  title: string;
  currentRound: StandRoundIndex;
  currentStandGroup: number;
  totalStandGroups: number;
  status: MatchStatus;
  updatedAt: number;
}

// ==========================================
// 5. 参加選手統合モデル & エントリーフォーム型
// ==========================================

export interface EntryPlayerItem {
  name: string;
  nameKana: string;
  shosa: ShosaType;
  rankTitle: RankTitleType;
  needsSupport: boolean;
  isStaffVolunteer: boolean;
}

export interface RepresentativeEntryFormData {
  representativeName: string;
  representativeEmail: string;
  representativePhone: string;
  representativeOrganization: string;
  players: EntryPlayerItem[];
  notes: string;
}

export interface Participant {
  id: string;
  bibNumber: number;
  name: string;
  nameKana: string;
  organization: string;
  shosa: ShosaType;
  rankTitle: RankTitleType;
  staffRole: StaffRoleType;
  staffDutyShift: StaffDutyShiftType;
  checkInStatus: CheckInStatus;
  checkInAt: number | null;
  isStaffVolunteer: boolean;
  needsSupport: boolean;
  standAssignments: Record<StandRoundIndex, StandAssignment>;
  progressStatus: ProgressStatus;
  qualificationStatus: QualificationStatus;
  stand1_arrows: HitResult[];
  stand2_arrows: HitResult[];
  stand3_arrows: HitResult[];
  isHayaHit: boolean;
  totalHits: number;
  totalShots: number;
  isPerfect: boolean;
  enkinRank: number | null;
  finalRank: number | null;
  representativeName: string;
  representativeEmail: string;
  representativePhone: string;
  representativeOrganization: string;
  isPaid: boolean;
  paidAt: number | null;
  notes: string;
  qrSentAt?: number | null;
  qrSentStatus?: QrDeliveryStatus;
  qrSentError?: string | null;
  agreedAt?: number | null;
  updatedAt?: number;
  userId?: string;
}

// ==========================================
// 6. フールプルーフ / フェイルセーフ ヘルパー関数群
// ==========================================

export function isHitResult(value: unknown): value is HitResult {
  return value === 1 || value === 0;
}

export function isStandRoundIndex(value: unknown): value is StandRoundIndex {
  return value === 1 || value === 2 || value === 3;
}

export function sanitizeStandRoundIndex(value: unknown): StandRoundIndex {
  const num = Number(value);
  if (num === 1 || num === 2 || num === 3) {
    return num;
  }
  console.warn(
    '【フェイルセーフ】不正な立インデックスを検出。第1立にフォールバック:',
    value,
  );
  return 1;
}

export function isShosaType(value: unknown): value is ShosaType {
  return value === '肌脱ぎ' || value === '襷掛け';
}

export function sanitizeShosaType(value: unknown): ShosaType {
  if (isShosaType(value)) {
    return value;
  }
  console.warn(
    '【フェイルセーフ】不正な所作区分を検出。肌脱ぎにフォールバック:',
    value,
  );
  return '肌脱ぎ';
}

export function isRankTitleType(value: unknown): value is RankTitleType {
  return (
    value === '段位は三段以下' ||
    value === '段位は四段以上' ||
    value === '称号を取得している'
  );
}

export function sanitizeRankTitleType(value: unknown): RankTitleType {
  if (isRankTitleType(value)) {
    return value;
  }
  console.warn(
    '【フェイルセーフ】不正な段位称号区分を検出。段位は三段以下にフォールバック:',
    value,
  );
  return '段位は三段以下';
}

/**
 * 【フールプルーフ】立順（射位番号: 1〜5）の安全なサニタイズ（未設定時はnullを返却）
 */
export function sanitizeStandOrder(value: unknown): StandOrderIndex | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = Number(value);
  if (num >= 1 && num <= 5) {
    return num as StandOrderIndex;
  }
  return null;
}

/**
 * 【フールプルーフ】組番号（1以上の自然数）の安全なサニタイズ（未設定時はnullを返却）
 */
export function sanitizeStandGroup(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = Number(value);
  if (!isNaN(num) && num >= 1) {
    return Math.floor(num);
  }
  return null;
}

export function isCheckInStatus(value: unknown): value is CheckInStatus {
  return value === 'UNCHECKED' || value === 'CHECKED_IN' || value === 'ABSENT';
}

export function sanitizeCheckInStatus(value: unknown): CheckInStatus {
  if (isCheckInStatus(value)) {
    return value;
  }
  console.warn(
    '【フェイルセーフ】不正な受付ステータスを検出。UNCHECKEDにフォールバック:',
    value,
  );
  return 'UNCHECKED';
}

export function isProgressStatus(value: unknown): value is ProgressStatus {
  return (
    value === 'WAITING' ||
    value === 'CALLED' ||
    value === 'IN_STAND' ||
    value === 'SHOOTING' ||
    value === 'FINISHED' ||
    value === 'COMPLETED'
  );
}

export function sanitizeProgressStatus(value: unknown): ProgressStatus {
  if (isProgressStatus(value)) {
    return value;
  }
  console.warn(
    '【フェイルセーフ】不正な進行ステータスを検出。WAITINGにフォールバック:',
    value,
  );
  return 'WAITING';
}

export function isQualificationStatus(
  value: unknown,
): value is QualificationStatus {
  return (
    value === 'ACTIVE' || value === 'DISQUALIFIED' || value === 'WITHDRAWN'
  );
}

export function sanitizeQualificationStatus(
  value: unknown,
): QualificationStatus {
  if (isQualificationStatus(value)) {
    return value;
  }
  console.warn(
    '【フェイルセーフ】不正な参加資格ステータスを検出。ACTIVEにフォールバック:',
    value,
  );
  return 'ACTIVE';
}
